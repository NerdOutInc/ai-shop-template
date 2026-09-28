import { Download } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import { DISPLAY_IMAGE_SIZES, type DisplayImageSize } from "@/features/design-library/display-image-sizes"
import type { LibraryArtworkRevision, LibraryAsset } from "@/features/design-library/library-types"
import { cn } from "@/lib/cn"

const BROWSING_SIZES: { size: DisplayImageSize; label: string }[] = [
  { size: "large", label: "Large" },
  { size: "medium", label: "Medium" },
  { size: "small", label: "Small" },
]

function dimensions(asset: LibraryAsset) {
  return asset.width && asset.height
    ? `${asset.width.toLocaleString("en-US")} × ${asset.height.toLocaleString("en-US")} px`
    : "Dimensions not yet verified"
}

export function ConceptDownloads({ revision }: { revision: LibraryArtworkRevision | null }) {
  const ready = (asset: LibraryAsset | null | undefined) => (asset?.status === "ready" ? asset : null)
  const print = ready(revision?.print) ?? ready(revision?.original)
  const transparent = print?.hasAlpha === true && print.hasTransparency === true
  const original = ready(revision?.original)

  return (
    <section aria-labelledby="downloads-heading" className="flex flex-col gap-4">
      <h2 id="downloads-heading" className="font-condensed text-2xl font-semibold">
        Artwork files
      </h2>
      {print ? (
        <>
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              Print file · {dimensions(print)}
              {revision?.widthInches && revision.heightInches
                ? ` · ${revision.widthInches} × ${revision.heightInches} in`
                : ""}
              {transparent ? " · transparent" : " · transparency not verified"}
            </p>
            <a
              href={`/api/admin/assets/${encodeURIComponent(print.id)}?download=1`}
              className={cn(buttonVariants(), "min-h-11 w-fit")}
            >
              <Download data-icon="inline-start" aria-hidden="true" />
              Download print file
            </a>
          </div>
          {transparent && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                Browsing sizes, derived from the print file with its transparency intact.
              </p>
              <div className="flex flex-wrap gap-2">
                {BROWSING_SIZES.map(({ size, label }) => (
                  <a
                    key={size}
                    href={`/api/admin/assets/${encodeURIComponent(print.id)}?size=${size}&download=1`}
                    className={cn(buttonVariants({ variant: "outline" }), "min-h-11")}
                  >
                    <Download data-icon="inline-start" aria-hidden="true" />
                    {label} · {DISPLAY_IMAGE_SIZES[size]} px
                  </a>
                ))}
              </div>
            </div>
          )}
          {!transparent && (
            <p className="text-sm text-muted-foreground">
              Browsing sizes appear once a transparent print file has been prepared and uploaded.
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {revision?.print?.status === "pending" ? "Print file upload pending." : "No print file is available yet."}
        </p>
      )}
      {original && original.id !== print?.id && (
        <a
          href={`/api/admin/assets/${encodeURIComponent(original.id)}?download=1`}
          className="inline-flex min-h-11 w-fit items-center text-sm underline underline-offset-4"
        >
          Download the preserved original source ({dimensions(original)})
        </a>
      )}
      {revision?.printNotes && <p className="text-sm text-muted-foreground">{revision.printNotes}</p>}
    </section>
  )
}
