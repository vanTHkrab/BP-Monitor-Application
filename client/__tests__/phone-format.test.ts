import { formatThaiPhone, stripPhoneDigits } from "@/src/utils/phone-format";

describe("formatThaiPhone", () => {
  it("formats a 10-digit number with leading 0 as 0XX-XXX-XXXX", () => {
    expect(formatThaiPhone("0812345678")).toBe("081-234-5678");
  });

  it("formats a 9-digit number without leading 0 as XX-XXX-XXXX", () => {
    expect(formatThaiPhone("812345678")).toBe("81-234-5678");
  });

  it("inserts hyphens progressively as digits are typed", () => {
    expect(formatThaiPhone("0")).toBe("0");
    expect(formatThaiPhone("08")).toBe("08");
    expect(formatThaiPhone("081")).toBe("081");
    expect(formatThaiPhone("0812")).toBe("081-2");
    expect(formatThaiPhone("081234")).toBe("081-234");
    expect(formatThaiPhone("0812345")).toBe("081-234-5");
  });

  it("strips non-digit characters before formatting", () => {
    expect(formatThaiPhone("081-234-5678")).toBe("081-234-5678");
    expect(formatThaiPhone("081 234 5678")).toBe("081-234-5678");
    expect(formatThaiPhone("(081) 234-5678")).toBe("081-234-5678");
  });

  it("rewrites international 66/+66 prefix to local 0", () => {
    expect(formatThaiPhone("+66812345678")).toBe("081-234-5678");
    expect(formatThaiPhone("66812345678")).toBe("081-234-5678");
    expect(formatThaiPhone("+66 81 234 5678")).toBe("081-234-5678");
  });

  it("truncates over-long input to the 10-digit ceiling", () => {
    expect(formatThaiPhone("08123456789999")).toBe("081-234-5678");
  });

  it("returns an empty string for empty / non-digit input", () => {
    expect(formatThaiPhone("")).toBe("");
    expect(formatThaiPhone("abc")).toBe("");
  });
});

describe("stripPhoneDigits", () => {
  it("removes every non-digit character", () => {
    expect(stripPhoneDigits("081-234-5678")).toBe("0812345678");
    expect(stripPhoneDigits("+66 81 234 5678")).toBe("66812345678");
    expect(stripPhoneDigits("abc123def456")).toBe("123456");
  });
});
