/** Printify's required inner-neck care layer is separate from the merchant's raster design. */
export function isProviderCareLabel(
  placeholder: { position: string; decoration_method?: string },
  image: {
    type?: string
    name?: string
    src?: string
    x?: number
    y?: number
    scale?: number
    angle?: number
    flipX?: boolean
    flipY?: boolean
    layerType?: string
    pattern?: unknown
    input_text?: string
    font_family?: string
    font_size?: unknown
    font_weight?: unknown
    font_color?: string
    font_style?: string
    text_align?: string
  }
): boolean {
  return (
    placeholder.position === "neck" &&
    placeholder.decoration_method === "dtf" &&
    image.type === "text/plain" &&
    image.name === "text_layer.svg" &&
    !image.src &&
    image.x === 0.5 &&
    image.y === 0.5 &&
    image.scale === 1 &&
    image.angle === 0 &&
    !image.flipX &&
    !image.flipY &&
    (image.layerType === undefined || image.layerType === "image") &&
    [
      image.pattern,
      image.input_text,
      image.font_family,
      image.font_size,
      image.font_weight,
      image.font_color,
      image.font_style,
      image.text_align,
    ].every((value) => value === undefined || value === null || value === "")
  )
}
