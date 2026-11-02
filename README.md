# TwoBirds Tipout

Static, installable event tip-out calculator. Serve this directory with any static
web server; there is no compilation or application build step.

## Tips and wedding guarantees

- **Total Tip Pot** remains the cash pot. Credit Tips and Number of Guests are
  optional and update the preview immediately; edits do not send receipts.
- Cash and credit use the same time cards: training shares 10% when training
  staff have positive hours; shift managers and bartenders share the remainder
  by hours. Hourly rates round to cents and individual payouts round down to whole
  dollars, preserving the original calculation and cash formatting.
- The prominent cash total is the sum of staff cash payouts. **With Credit Tips**
  adds the separately calculated credit payouts, not a second tip-out.
- The event-wide guarantee is $4 per guest. Its shortage is the nonnegative
  difference between that minimum and actual cash plus credit payouts. Blank
  guests disable the guarantee; zero guests explicitly enables a $0 guarantee.
  Invalid guest counts show a validation error and cannot be submitted.
- Additional paycheck shares use the same time cards and distribution rules.
  Any difference between the event shortage and whole-dollar shares appears as
  a separate rounding adjustment; it is not silently discarded.
- Drafts retain optional inputs; Reset clears them. Existing drafts still work.
- **Calculate & Send Receipt** retains the manager, venue, name, and time-card
  requirements. It sends the current preview only when explicitly clicked.

## Login and venue loading

PIN verification and saved-session validation still require a successful server
response; they time out after 20 seconds rather than waiting indefinitely. PIN
verification displays slow-service feedback after 3 seconds. Google Apps Script
startup and network latency can still affect authentication.

Selecting or changing a venue does not make any staff-loading requests. Staff
names and hours are entered manually. There is no Toast API integration or API
credential requirement.

## Personal daily earnings

Only the existing authenticated Will Schreiner account receives a personal
earnings profile from the backend. No additional password is embedded in the
page. Its private-in-the-UI section uses Will's own named time card(s) at $15/hour
plus his cash payouts and credit payouts. Two separate bottom sections compare:

- **Without Tip Minimum:** hourly wages plus Will's actual tips after tip-out.
- **With Tip Minimum:** those same earnings plus only Will's allocated guarantee
  paycheck share, using the existing time-card distribution. A valid guest count
  is required; when the event minimum is met, both totals are identical.
  A green **Minimum met** message means no extra pay is needed; a red
  **Below minimum** message means extra pay is owed. This checks the event's
  actual combined tips against its $4-per-guest minimum, not hourly wages.
  No colored status is shown without a valid guest count.

Each section shows before-tax earnings, estimated tax, and estimated after-tax
earnings. The shared summary shows Will's hours, hourly wages, and total tips.
Estimated after-tax earnings use a 20.75% effective withholding rate derived
from one supplied paystub. The unrounded rate is used internally; tax and net
amounts round to cents. This includes cash already received and is not a paycheck
deposit estimate or an exact payroll tax calculation.

Will's section also offers **Download Earnings (CSV)** for saving a local record
in Excel, Google Sheets, or Numbers. Each file includes today's local date, the
selected venue, Will's hours, wages, actual tips, and the before-tax, estimated
tax, and after-tax totals for both comparisons. Without a guest count, the
with-minimum comparison is explicitly marked not calculated rather than saved
as zero. Downloads use the current inputs, require Will's positive hours and a
venue, and do not send a receipt or upload the earnings record. Files are
individual snapshots, not an automatically maintained earnings history.

The profile is fetched only through authenticated login/session validation,
is not saved in drafts, is not added to shared receipts, and is cleared when the
session is cleared. Other accounts do not receive the profile. The updated
Apps Script deployment is required before this section can appear.

## Receipt deployment

The receipt handler in [google-apps-script.gs](google-apps-script.gs) retains the
existing four-column cash receipt and adds credit details, the event guarantee,
and paycheck shares when provided. After publishing the updated static page,
update and redeploy the existing Google Apps Script web app as well. If the
deployment URL changes, update `RECEIPT_ENDPOINT` in [index.html](index.html).
An older backend will ignore the new optional receipt fields.

## Verification

Requires Node.js 18+:

```text
npm ci
npm test
```

Tests compile-check both production scripts, compare cash calculations to the
original algorithm, verify receipt row data, and exercise the real page in a
headless browser, including live inputs, drafts, reset, send authorization, and
320px/390px/720px layouts. Browser tests use an existing Chrome or Edge on Windows.
Elsewhere, run `npx playwright install chromium`, or set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an installed Chromium-based browser.
External requests are blocked or intercepted; tests do not send live receipts
or access manager/Toast services. Live Apps Script deployment and spreadsheet
integration require separate verification after redeployment.
