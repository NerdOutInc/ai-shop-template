# Measure link rectangles on the final artwork

Use the included Python 3.9+ helper without installing packages. From the installed skill folder:

```bash
python3 scripts/measure-click-areas.py references/layout-example.json
python3 scripts/measure-click-areas.test.py
```

Copy the [example JSON](layout-example.json) to project working storage. Replace the illustrative dimensions with the **decoded full source canvas** dimensions of each final image. Replace every region with its measured `[left, top, width, height]` in those source pixels. Each label identifies the same destination in both views. The labels are local keys, not product IDs or URLs; record real destinations separately in the release receipt.

`safeArea` is optional and defaults to the full image. Supply the region guaranteed visible by the actual renderer when it crops; the example's central desktop half is illustrative. The helper rejects links outside that region, overlapping destinations, inconsistent destination sets, invalid numbers and off-canvas rectangles. It returns percentages using the full source width/height, and writes no files.

For example, a desktop region beginning at x = 660 on a 2400 px canvas starts at **27.5%**, not 5% of the safe center. A mobile region has its own measurements. Convert the returned `left`/`top` keys to the receiving editor's names only after checking its schema; this is not an API payload.

The helper cannot see the images, verify their dimensions, decide whether the label/garment fits, enforce an application's minimum region size, assess cropping across viewports or approve visual placement. Validate the result against the current host schema and saved browser preview. Its successful output deliberately says `arithmetic-only-not-visual-approval`.
