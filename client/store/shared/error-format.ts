// Heuristic: a string is "Thai-friendly" if it contains any Thai characters.
// We let those pass through unchanged (they came from the backend's localized
// validation messages). Anything else gets normalized to a generic Thai
// message so we don't leak raw English GraphQL errors into the UI.
const containsThai = (text: string) => /[฀-๿]/.test(text);

export const authErrorToThai = (msg?: string): string => {
  if (!msg) return "เกิดข้อผิดพลาด กรุณาลองใหม่";
  if (msg.includes("Network request timed out")) {
    return "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จภายในเวลาที่กำหนด กรุณาตรวจสอบว่าโทรศัพท์เข้าถึงเครื่องที่รัน Nest ได้";
  }
  if (msg.includes("Network request failed")) {
    return "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบ IP, Wi-Fi และพอร์ตของ Nest GraphQL";
  }
  if (containsThai(msg)) return msg;
  return "เกิดข้อผิดพลาด กรุณาลองใหม่";
};
