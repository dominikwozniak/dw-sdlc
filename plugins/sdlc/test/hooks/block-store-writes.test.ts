// What block-store-writes.sh runs (exit 0) and refuses (exit 2), fed the real hook payload: a table of
// Bash commands and the outcome each must get, so a new `asc` verb is one row. The guard reads no
// config, so no repository is built.

import { describe, it } from "node:test"

import { bashPayload, expectExit, runHook } from "../harness.ts"

/** The flags every `asc metadata` call on the listing carries; `--version` is the app's, not asc's. */
const LISTING = "--app 6742772020 --version 2.1.4 --dir store/listing"
const VERSION_ID = "5058f966-7a19-4f8c-ba81-4e0ba8bd14c2"
const IMAGE_ID = "b1e0c3a2-6f4d-4e8a-9c71-2d5f8a0e7b43"
const VIDEO_ID = "3a9f5d2c-81e4-4b07-b6c3-5e2d0f9a7c18"
const LIBRARY_ID = "7d2e9f10-3b6c-4a85-8e1f-c4a0b9d26e57"
const LOCALIZATION_ID = "e4c81a7b-0d93-4f2e-a6b5-91f3c07d8e26"
const PLACEMENT_GROUP = "IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE"

type Outcome = "runs" | "refused"

const EXIT: Record<Outcome, number> = { runs: 0, refused: 2 }

function table(rows: [command: string, outcome: Outcome][]): void {
  for (const [command, outcome] of rows) {
    it(`${outcome === "runs" ? "runs" : "refuses"} ${command}`, () => {
      expectExit(runHook("block-store-writes", bashPayload(command)), EXIT[outcome])
    })
  }
}

describe("the listing's reads", () => {
  table([
    [`asc metadata pull ${LISTING}`, "runs"],
    [`asc metadata plan ${LISTING}`, "runs"],
    [`asc metadata diff ${LISTING}`, "runs"],
    ["asc metadata validate --dir store/listing --check-urls --subscription-app", "runs"],
    [`asc localizations download --version ${VERSION_ID} --path tmp`, "runs"],
    ["asc screenshots sizes --all", "runs"],
    ["asc metadata init --dir store/listing --version 2.1.4 --locale en-US", "runs"],
    ["asc metadata approve --review-dir .asc/metadata/review --all", "runs"],
    ["asc metadata status --review-dir .asc/metadata/review", "runs"]
  ])
})

describe("the asset library's reads", () => {
  table([
    ["asc asset-library specs", "runs"],
    [`asc asset-library images placements --id ${IMAGE_ID}`, "runs"],
    [`asc asset-library videos placements --id ${VIDEO_ID}`, "runs"],
    ["asc asset-library view --app 6742772020", "runs"],
    [`asc asset-library images list --library-id ${LIBRARY_ID} --paginate`, "runs"],
    [`asc asset-library images view --id ${IMAGE_ID}`, "runs"],
    [`asc localizations placements list --localization-id ${LOCALIZATION_ID} --include image`, "runs"],
    [
      `asc localizations placements list --localization-id ${LOCALIZATION_ID} --include image --sort placementGroupPosition --paginate --output json`,
      "runs"
    ],
    [`asc localizations list --version ${VERSION_ID} --paginate --output json`, "runs"],
    ["asc versions list --app 6742772020 --platform IOS --paginate --output json", "runs"]
  ])
})

describe("show reads", () => {
  table([
    ["asc docs show reference", "runs"],
    ["asc docs show reference --confirm", "refused"],
    ["asc show metadata apply", "refused"],
    ["asc docs show reference apply", "refused"]
  ])
})

describe("search reads asc's own command index, never the store", () => {
  table([
    ["asc search foo", "runs"],
    ['asc search "external testers"', "runs"],
    ['asc search --output json "submit app for review"', "runs"],
    ["asc search --limit 5 cert profiles", "runs"],
    ["asc search apply --confirm", "refused"],
    ["asc --profile owner search foo", "refused"]
  ])
})

describe("App Store Connect writes, with or without --confirm", () => {
  table([
    [`asc metadata apply ${LISTING}`, "refused"],
    [`asc metadata push ${LISTING}`, "refused"],
    [`asc metadata keywords apply ${LISTING}`, "refused"],
    [`asc metadata keywords sync ${LISTING} --input keywords.json --confirm`, "refused"],
    [`asc localizations create --version ${VERSION_ID} --locale en-AU`, "refused"],
    ['asc localizations update --app 6742772020 --locale en-US --description "Notice the good."', "refused"],
    [`asc localizations upload --version ${VERSION_ID} --path tmp`, "refused"],
    ["asc versions create --app 6742772020 --version 2.2.0", "refused"],
    [`asc versions update --version-id ${VERSION_ID} --copyright "2026 Arcadia"`, "refused"],
    ['asc apps rename --app 6742772020 --locale en-US --name "Grateful Me"', "refused"],
    ["asc apps update --id 6742772020 --primary-locale en-US", "refused"],
    ["asc apps search-keywords set --app 6742772020 --version 2.1.4 --locale en-US --keywords gratitude", "refused"],
    [`asc asset-library images upload --library-id ${LIBRARY_ID} --file shots/01-wpis.png`, "refused"],
    [`asc asset-library images rename --id ${IMAGE_ID} --name 01-wpis.3f9a2c1e.png`, "refused"],
    [`asc asset-library images archive --id ${IMAGE_ID} --confirm`, "refused"],
    [`asc asset-library images unarchive --id ${IMAGE_ID}`, "refused"],
    [`asc asset-library images delete --id ${IMAGE_ID} --confirm`, "refused"],
    [`asc asset-library videos upload --library-id ${LIBRARY_ID} --file previews/01-wpis.mp4`, "refused"],
    [`asc asset-library videos set-poster-frame --id ${VIDEO_ID}`, "refused"],
    [
      `asc localizations placements create --localization-id ${LOCALIZATION_ID} --image-id ${IMAGE_ID} --placement-type APP_SCREENSHOT --placement-group ${PLACEMENT_GROUP}`,
      "refused"
    ],
    [
      `asc localizations placements reorder --localization-id ${LOCALIZATION_ID} --placement-group ${PLACEMENT_GROUP} --placement-ids p1,p2`,
      "refused"
    ],
    [
      `asc localizations placements swap --localization-id ${LOCALIZATION_ID} --placement-id p1 --image-id ${IMAGE_ID} --placement-type APP_SCREENSHOT --confirm`,
      "refused"
    ],
    ["asc localizations placements delete --placement-ids p1,p2 --confirm", "refused"]
  ])
})

describe("--dry-run runs only without --confirm", () => {
  table([
    [`asc metadata apply ${LISTING} --dry-run`, "runs"],
    [`asc metadata apply ${LISTING} --dry-run --confirm`, "refused"],
    ["asc screenshots upload --app 6742772020 --version 2.1.4 --path shots --device-type IPHONE_69 --dry-run", "runs"],
    [
      "asc screenshots upload --app 6742772020 --version 2.1.4 --path shots --device-type IPHONE_69 --dry-run --confirm",
      "refused"
    ],
    [`asc localizations upload --version ${VERSION_ID} --path tmp --dry-run`, "runs"],
    [`asc localizations upload --version ${VERSION_ID} --path tmp --dry-run --confirm`, "refused"]
  ])
})

describe("a flag counts in every spelling asc reads, and the last one wins", () => {
  table([
    [`asc metadata apply ${LISTING} -dry-run`, "runs"],
    [`asc metadata apply ${LISTING} --dry-run --dry-run=false`, "refused"],
    [`asc metadata apply ${LISTING} --dry-run -confirm`, "refused"],
    [`asc metadata apply ${LISTING} --dry-run --confirm=1`, "refused"]
  ])
})

describe("the verb is the last word before the first flag", () => {
  table([
    ["asc metadata keywords audit --app 6742772020 --version 2.1.4", "runs"],
    [`asc metadata keywords push --version-id ${VERSION_ID} --input keywords.json`, "refused"],
    ["asc apps info view --app 6742772020", "runs"],
    ["asc --version", "runs"],
    [`asc metadata apply ${LISTING} --help`, "runs"]
  ])
})

describe("a flag before the command is refused, since its value would hide the verb", () => {
  table([
    [`asc --profile owner metadata apply ${LISTING}`, "refused"],
    [`asc --profile=owner metadata push ${LISTING}`, "refused"],
    [`asc --profile owner metadata pull ${LISTING}`, "refused"]
  ])
})

describe("a wrapper does not change the verdict", () => {
  table([
    [`rtk asc metadata pull ${LISTING}`, "runs"],
    [`rtk asc metadata apply ${LISTING}`, "refused"],
    [`rtk proxy asc metadata push ${LISTING}`, "refused"],
    [`env ASC_PROFILE=owner asc metadata plan ${LISTING}`, "runs"],
    [`env ASC_PROFILE=owner asc metadata apply ${LISTING}`, "refused"],
    [`sudo asc metadata apply ${LISTING}`, "refused"],
    [`ASC_PROFILE=owner asc metadata pull ${LISTING}`, "runs"],
    [`ASC_PROFILE=owner asc metadata push ${LISTING}`, "refused"],
    [`/opt/homebrew/bin/asc metadata apply ${LISTING}`, "refused"]
  ])
})

describe("a command chain is judged command by command", () => {
  table([
    [`asc apps list && asc metadata apply ${LISTING}`, "refused"],
    [`asc metadata plan ${LISTING} 2>&1 | head -40`, "runs"],
    [`asc metadata pull ${LISTING} > pull.json`, "runs"],
    ['git commit -m "docs: never run asc; metadata apply"', "runs"]
  ])
})

describe("the listing's script", () => {
  table([
    ["pnpm store:listing", "runs"],
    ["pnpm store:listing --check", "runs"],
    ["pnpm store:listing --pull", "runs"],
    ["pnpm store:listing --confirm", "refused"],
    ["pnpm store:listing '--confirm'", "refused"],
    ['pnpm store:listing "--confirm"', "refused"],
    ["node scripts/store-listing.ts --confirm --listing store/listing", "refused"],
    ["pnpm store:listing && pnpm store:listing --confirm", "refused"]
  ])
})

describe("prices", () => {
  table([
    ["pnpm store:pricing", "runs"],
    ["pnpm store:pricing --check", "runs"],
    ["pnpm store:pricing --confirm --no-preserve", "refused"],
    ["pnpm store:pricing '--confirm' --no-preserve", "refused"],
    ["node scripts/store-pricing.ts --confirm --preserve", "refused"],
    ["asc subscriptions groups list --app 6742772020", "runs"],
    ["asc subscriptions pricing summary --subscription-id 6742772021", "runs"],
    ["asc subscriptions pricing prices set --subscription-id 6742772021 --price 29.99", "refused"],
    ["asc subscriptions offers introductory create --subscription-id 6742772021 --territory USA", "refused"]
  ])
})

describe("--confirm is refused on every store command, one not written yet included", () => {
  table([
    ["pnpm store:screenshots", "runs"],
    ["pnpm store:screenshots --check", "runs"],
    ["pnpm store:screenshots --import ../grateful-me-content", "runs"],
    ["node scripts/store-screenshots.ts --import ../grateful-me-content", "runs"],
    ["pnpm store:screenshots --confirm", "refused"],
    ["pnpm store:screenshots '--confirm'", "refused"],
    ['pnpm store:screenshots "--confirm"', "refused"],
    ["node scripts/store-screenshots.ts --confirm", "refused"],
    ["node scripts/store-screenshots.ts '--confirm'", "refused"],
    ["rtk pnpm store:screenshots --confirm", "refused"],
    ["env ASC_PROFILE=owner pnpm store:screenshots --confirm", "refused"],
    ["sudo node scripts/store-screenshots.ts --confirm", "refused"],
    ["ASC_PROFILE=owner node scripts/store-screenshots.ts --confirm", "refused"],
    ["pnpm store:screenshots \\\n  --confirm", "refused"],
    ["node scripts/store-pricing.ts \\\n  --confirm --preserve", "refused"],
    ["pnpm store:listing \\\n  --check", "runs"],
    ["pnpm store:previews --confirm", "refused"],
    ["node scripts/store-previews.ts --confirm", "refused"],
    ["pnpm store:price-levels", "runs"],
    ["pnpm store:price-levels --write", "runs"]
  ])
})

describe("the plugin's word reader: a command handed to a shell counts, prose does not", () => {
  table([
    [`bash -c "asc metadata apply ${LISTING}"`, "refused"],
    [`bash -c "asc metadata pull ${LISTING} && asc metadata push ${LISTING}"`, "refused"],
    ["rtk run 'pnpm store:listing --confirm'", "refused"],
    [`echo "$(asc metadata apply ${LISTING})"`, "refused"],
    ['git commit -m "docs: the owner runs pnpm store:listing --confirm at a terminal"', "runs"],
    [`cat > notes.md <<EOF\nasc metadata apply ${LISTING}\nEOF`, "runs"],
    ["pnpm add -D javascript-obfuscator", "runs"]
  ])
})
