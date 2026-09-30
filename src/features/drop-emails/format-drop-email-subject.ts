/** "New this week: Abstract Lines", from the design names rather than every garment's title. */
export function formatDropEmailSubject(designNames: readonly string[]) {
  const [first, second] = designNames
  const subject =
    designNames.length > 2
      ? `New this week: ${first}, ${second} and ${designNames.length - 2} more`
      : `New this week: ${designNames.join(" and ")}`
  // Inboxes cut a subject off near 60 characters anyway; this only stops a runaway title.
  return designNames.length === 0 || subject.length > 150 ? "New designs this week" : subject
}
