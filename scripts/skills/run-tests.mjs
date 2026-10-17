import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"

const photoPython =
  process.env.PHOTO_SKILLS_PYTHON ||
  path.resolve(".tmp/photo-skills-venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python")

if (!existsSync(photoPython)) {
  throw new Error(
    "Create .tmp/photo-skills-venv with Python 3.9–3.12 and install store-garment-photography/scripts/requirements.txt, or set PHOTO_SKILLS_PYTHON to that environment's interpreter."
  )
}

const run = (python, args) => execFileSync(python, args, { stdio: "inherit" })
run(photoPython, [
  "-c",
  'import PIL, numpy; from pathlib import Path; expected=Path(".agents/skills/store-garment-photography/scripts/requirements.txt").read_text(encoding="utf-8").splitlines(); actual=["Pillow=="+PIL.__version__,"numpy=="+numpy.__version__]; exit(0 if actual == expected else "Photo skill environment does not match pinned requirements")',
])
run("python3", [".agents/skills/store-design-concepts/scripts/inspect-print-assets.test.py"])
run("python3", [".agents/skills/store-model-casting/scripts/validate-cast.test.py"])
run("python3", [".agents/skills/store-garment-photography/scripts/verify-review.test.py"])
run(photoPython, [".agents/skills/store-garment-photography/scripts/composite.test.py"])
run("python3", [".agents/skills/store-weekly-hero/scripts/measure-click-areas.test.py"])
