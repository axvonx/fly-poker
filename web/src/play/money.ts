// The engine counts chips; the page shows money. One chip is one cent: blinds $0.50 / $1,
// and both players start every hand with $200.

export function dollars(chips: number): string {
  const d = chips / 100;
  return `$${Number.isInteger(d) ? d.toLocaleString() : d.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Signed, for a running score: "+$12.50", "−$3". */
export function signedDollars(chips: number): string {
  return chips > 0 ? `+${dollars(chips)}` : chips < 0 ? `−${dollars(-chips)}` : dollars(0);
}
