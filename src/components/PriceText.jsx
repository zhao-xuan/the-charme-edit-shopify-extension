// Preserve the translated label while styling the price separately.
export default function PriceText({ text, price }) {
  const index = text.indexOf(price)
  if (!price || index < 0) return text
  return <span>{text.slice(0, index)}<span className="price-value">{price}</span>{text.slice(index + price.length)}</span>
}
