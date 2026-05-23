export function isJsonString(data: string): object | false {
  try {
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    /* not JSON */
  }
  return false;
}

export function sleep(sec: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, sec * 1000));
}

export function calc(expr: string): number {
  return new Function(`"use strict"; return (${expr})`)();
}
