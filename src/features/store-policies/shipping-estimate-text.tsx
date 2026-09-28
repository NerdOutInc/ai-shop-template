export function ShippingEstimateText({ children }: { children: string }) {
  return children.split(/(\d+–\d+)/).map((part, index) =>
    index % 2 ? (
      <span key={index} className="whitespace-nowrap">
        {part}
      </span>
    ) : (
      part
    )
  )
}
