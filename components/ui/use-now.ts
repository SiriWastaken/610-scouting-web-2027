import { useEffect, useState } from "react";

/** The current time, updated every `intervalMs`, so render stays pure while "5s ago" labels keep moving. */
export function useNow(intervalMs = 5_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
