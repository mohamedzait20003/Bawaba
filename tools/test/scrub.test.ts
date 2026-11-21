import { describe, expect, it } from "vitest";
import { bytesToBase64, type Capture } from "../capture/capture.ts";
import { categoryOf, Scrubber } from "../fixtures/scrub.ts";

// A Luhn-valid number that is not a public test card, built at runtime so no real-looking number sits in the source.
function withCheckDigit(partial: string): string {
  for (let digit = 0; digit <= 9; digit++) {
    const candidate = `${partial}${digit}`;
    let sum = 0;

    for (let i = 0; i < candidate.length; i++) {
      let d = Number(candidate[candidate.length - 1 - i]);

      if (i % 2 === 1) {
        d *= 2;
        if (d > 9) d -= 9;
      }

      sum += d;
    }

    if (sum % 10 === 0) return candidate;
  }

  throw new Error("unreachable");
}

const REAL_CARD = withCheckDigit("400000123456789");

describe("categoryOf", () => {
  it.each([
    ["first_name", "name"],
    ["customer_name", "name"],
    ["customer_email", "email"],
    ["phone_number", "phone"],
    ["customerMobile", "phone"],
    ["street", "address"],
    ["billing_address", "address"],
    ["masked_pan", "card"],
    ["last_four", "card"],
    ["api_key", "credential"],
    ["payment_token", "credential"],
    ["access_code", "credential"],
    ["merchant_id", "merchant"],
    ["profile_id", "merchant"],
    ["customer_ip", "ip"],
  ])("%s is %s", (key, category) => {
    expect(categoryOf(key)).toBe(category);
  });

  it.each(["amount", "currency", "status", "id", "order_id", "country", "signature", "created_at"])("%s is kept", (key) => {
    expect(categoryOf(key)).toBeUndefined();
  });
});

describe("Scrubber.scrubJson", () => {
  it("replaces personal data and keeps every other byte", () => {
    const body =
      '{"amount_cents":  25000,"amount":"250.00","billing_data":{"first_name":"Mona","last_name":"Adel","email":"mona@gmail.com",' +
      '"phone_number":"+201234567890","street":"12 Real St","city":"Giza","postal_code":"12611"},"note":"a\\/b\\u00e9","ok":true,"none":null}';
    const scrubbed = new Scrubber().scrubJson(body);

    expect(scrubbed).toBe(
      '{"amount_cents":  25000,"amount":"250.00","billing_data":{"first_name":"Test","last_name":"Customer","email":"customer@example.com",' +
        '"phone_number":"+201000000001","street":"Test Address","city":"Test City","postal_code":"00000"},"note":"a\\/b\\u00e9","ok":true,"none":null}',
    );
  });

  it("replaces card data, credentials, merchant IDs and IPs", () => {
    const body = `{"pan":"${REAL_CARD}","masked_pan":"512345******2346","token":"tok_real","merchant_id":4521,"profile_id":"PRF-123","customer_ip":"203.0.113.9"}`;
    expect(new Scrubber().scrubJson(body)).toBe(
      '{"pan":"4111111111111111","masked_pan":"411111******1111","token":"test_fake_do_not_use","merchant_id":1000,"profile_id":"MID-0000-0000","customer_ip":"192.0.2.1"}',
    );
  });

  it("gives the same fake to the same phone, and different fakes to different phones", () => {
    const scrubbed = new Scrubber().scrubJson('{"phone":"+201111111111","mobile":"201111111111","phone2":"+966500000000","msisdn":966500000001}');
    expect(scrubbed).toBe('{"phone":"+201000000001","mobile":"+201000000001","phone2":"+201000000002","msisdn":201000000003}');
  });

  it("scrubs inside arrays, using the key of the array", () => {
    expect(new Scrubber().scrubJson('{"emails":["a@gmail.com","b@test.example"],"items":[{"name":"Shirt","price":"10.00"}]}')).toBe(
      '{"emails":["customer@example.com","customer@example.com"],"items":[{"name":"Test Customer","price":"10.00"}]}',
    );
  });

  it("finds emails and real card numbers under any key, and keeps test cards", () => {
    const body = `{"note":"contact mona@gmail.com or ops@example.com","ref":"${REAL_CARD}","test":"4111111111111111","n":${REAL_CARD},"id":12345}`;
    expect(new Scrubber().scrubJson(body)).toBe(
      '{"note":"contact customer@example.com or ops@example.com","ref":"4111111111111111","test":"4111111111111111","n":4111111111111111,"id":12345}',
    );
  });

  it("keeps empty values and negative or fractional numbers", () => {
    expect(new Scrubber().scrubJson('{"email":"","amount":-1.5e2,"phone":[]}')).toBe('{"email":"","amount":-1.5e2,"phone":[]}');
  });

  it("counts what it replaced", () => {
    const scrubber = new Scrubber();
    scrubber.scrubJson('{"first_name":"Mona","email":"mona@gmail.com","note":"x@gmail.com","merchant_id":"MID-0000-0000"}');
    expect(scrubber.counts).toEqual({ name: 1, email: 2 });
  });
});

describe("Scrubber.scrubForm", () => {
  it("replaces only the pairs it must, byte for byte otherwise", () => {
    const form = "amount=150000&customer_email=mona%40gmail.com&signature=a%2Bb%3D&customer_name=Mona+Adel&flag&bad=%E0%A4%A";
    expect(new Scrubber().scrubForm(form)).toBe(
      "amount=150000&customer_email=customer%40example.com&signature=a%2Bb%3D&customer_name=Test%20Customer&flag&bad=%E0%A4%A",
    );
  });
});

describe("Scrubber.scrubBody", () => {
  it("picks JSON, form or free text", () => {
    const scrubber = new Scrubber();
    expect(scrubber.scrubBody(' {"email":"a@gmail.com"}')).toBe(' {"email":"customer@example.com"}');
    expect(scrubber.scrubBody("email=a%40gmail.com")).toBe("email=customer%40example.com");
    expect(scrubber.scrubBody("free text a@gmail.com")).toBe("free text customer@example.com");
    expect(scrubber.scrubBody("{not json a@gmail.com")).toBe("{not json customer@example.com");
    expect(scrubber.scrubBody("")).toBe("");
  });
});

describe("Scrubber.scrubCapture", () => {
  it("decodes the captured bytes and scrubs body, headers and query", () => {
    const capture: Capture = {
      id: "c1",
      gateway: "paymob",
      label: null,
      receivedAt: "2026-11-19T10:00:00.000Z",
      method: "POST",
      path: "/hooks/paymob",
      rawQuery: "hmac=abc&email=a%40gmail.com&hmac=second",
      headers: { "content-type": "application/json", "content-length": "44", host: "rx.example.test", "x-note": "from a@gmail.com" },
      rawBodyBase64: bytesToBase64(new TextEncoder().encode('{"first_name":"Ù…Ù†Ù‰","amount":"250.00"}')),
    };

    expect(new Scrubber().scrubCapture(capture)).toEqual({
      rawBody: '{"first_name":"Test","amount":"250.00"}',
      headers: { "content-type": "application/json", "x-note": "from customer@example.com" },
      query: { hmac: "abc", email: "customer@example.com" },
    });
  });
});
