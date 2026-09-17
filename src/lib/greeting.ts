export function timeAwareGreeting(name: string, now: Date = new Date()): string {
  const hour = now.getHours();
  let part: string;
  if (hour < 5) part = "evening";
  else if (hour < 12) part = "morning";
  else if (hour < 17) part = "afternoon";
  else part = "evening";
  return `Good ${part}, ${name}`;
}
