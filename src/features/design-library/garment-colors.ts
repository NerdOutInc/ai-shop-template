export type GarmentColor = { name: string; hex: string }

/**
 * Every colour Printify offers for blueprint 1317 (Next Level 6210 Unisex CVC Jersey
 * T-shirt) from print provider 99, in Printify's own order. The catalogue API returns
 * these names but no swatch values, so the hex of a colour we already sell comes from
 * the published storefront, and the rest are measured from the provider's swatches.
 * A heather is a textured knit, so its hex is the representative tone, not a flat dye.
 *
 * Names are the join key for `library_design_colors`; changing one orphans saved rows.
 */
export const GARMENT_COLORS: GarmentColor[] = [
  { name: "CVC White", hex: "#f6fbfe" },
  { name: "CVC Warm Gray", hex: "#928984" },
  { name: "CVC Silk", hex: "#c7c7c5" },
  { name: "CVC Stone Gray", hex: "#919291" },
  { name: "Heather Heavy Metal", hex: "#4e5c5c" },
  { name: "Dark Heather Grey", hex: "#5f5f61" },
  { name: "CVC Charcoal", hex: "#42424c" },
  { name: "CVC Black", hex: "#242529" },
  { name: "CVC Red", hex: "#d01f2c" },
  { name: "CVC Espresso", hex: "#5f4c3e" },
  { name: "Heather Maroon", hex: "#6a3b43" },
  { name: "CVC Cardinal", hex: "#904049" },
  { name: "CVC Cream", hex: "#ded1be" },
  { name: "CVC Sand", hex: "#cfc8bc" },
  { name: "CVC Banana Cream", hex: "#fbd898" },
  { name: "CVC Orange", hex: "#e99d36" },
  { name: "CVC Neon Heather Green", hex: "#b3e7a0" },
  { name: "CVC Apple Green", hex: "#8ac38c" },
  { name: "CVC Mint", hex: "#b1dece" },
  { name: "CVC Light Olive", hex: "#7f846d" },
  { name: "CVC Kelly Green", hex: "#309b5d" },
  { name: "CVC Military Green", hex: "#676244" },
  { name: "Heather Forest Green", hex: "#2a4f4f" },
  { name: "CVC Teal", hex: "#35a1a5" },
  { name: "CVC Tahiti Blue", hex: "#32becb" },
  { name: "CVC Bondi Blue", hex: "#44b2ca" },
  { name: "CVC Ice Blue", hex: "#ccdfe2" },
  { name: "CVC Turquoise", hex: "#1987b0" },
  { name: "Heather Columbia Blue", hex: "#7ba5d5" },
  { name: "CVC Indigo", hex: "#32404e" },
  { name: "CVC Royal", hex: "#165192" },
  { name: "Heather Cool Blue", hex: "#32548a" },
  { name: "CVC Midnight Navy", hex: "#283244" },
  { name: "CVC Storm", hex: "#4c4e6b" },
  { name: "CVC Purple Rush", hex: "#614084" },
  { name: "Heather Mauve", hex: "#cc717f" },
]
