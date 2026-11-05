# TwoBirds Tipout

Static, installable event tip-out calculator. Serve this directory with any static
web server; there is no compilation or application build step.

## Tips and wedding guarantees

- **Total Tip Pot** remains the cash pot. Credit Tips and Number of Guests are
  optional and update the preview immediately.
- Cash and credit use the same time cards: shift managers and bartenders share
  tips by hours; trainees are not included. Cash hourly rates keep their existing
  cent rounding; individual cash payouts now round UP to whole dollars. Cash is
  displayed without decimals.
  Any extra cash needed above the pot (or cash still unallocated) is explicitly
  shown in the results; it is not silently taken from credit tips.
  Credit inputs accept cents and retain them in drafts. Credit and paycheck
  allocations use the same role/hour weights without rounding the hourly rate
  before allocation. Whole cents are assigned by largest fractional remainder
  (row order breaks ties), so eligible staff shares add up exactly to the pool.
  Displayed hourly rates, credit payouts, and combined amounts use two decimals.
- The prominent cash total is the sum of staff cash payouts. **With Credit Tips**
  adds the separately calculated credit payouts, not a second tip-out.
- **Is this event a wedding?** (Yes/No, default No) controls the guarantee. The
  $4-per-guest minimum applies only when Yes is selected; the guest count field
  is shown only for weddings. With No, any entered or saved guest count is
  ignored: there is no guarantee, no minimum messages, and no tip minimum in
  personal earnings, estimated tax, the PDF, or saved shifts. The selection is
  saved in drafts (older drafts default to No) and Reset returns it to No.
- The event-wide wedding guarantee is $4 per guest. Its shortage is the nonnegative
  difference between that minimum and actual cash plus credit payouts. Blank
  guests disable the guarantee; zero guests explicitly enables a $0 guarantee.
  Invalid guest counts show a validation error.
- Additional paycheck shares use the same shift-manager and bartender time cards and cent distribution.
  The guarantee compares actual rounded-up cash payouts plus exact credit
  payouts, not formatted hourly rates. Extra cash needed for rounding is part
  of these actual cash payouts and must be funded separately. Paycheck amounts
  retain cents. With no eligible staff, unallocated money remains explicit.
- Drafts retain optional inputs; Reset clears them. Existing drafts still work.
- Results are a live preview only. The Google Sheets receipt system (the old
  **Calculate & Send Receipt** button and notes field) has been removed; the
  calculator no longer sends or writes event receipts anywhere.

## Login and venue loading

PIN verification and saved-session validation still require a successful server
response; they time out after 20 seconds rather than waiting indefinitely. PIN
verification displays slow-service feedback after 3 seconds. Google Apps Script
startup and network latency can still affect authentication.

Selecting or changing a venue does not make any staff-loading requests. Staff
names and hours are entered manually. There is no Toast API integration or API
credential requirement.

## Personal daily earnings

Only the existing authenticated Will Schreiner and Renee Ehlers accounts receive
their matching personal earnings profiles from the backend. No additional PINs
are embedded in the page. Each private-in-the-UI section uses only that
employee's named time card(s), tips, and actual role rate. Will earns $15/hour.
Renee earns $12/hour as a bartender and $14/hour as shift manager. Her role
rates are weighted by the hours on each matching time card. If she is assigned
an unsupported role, her personal totals and download are paused until the
time-card role is corrected.

The two bottom sections compare:

- **Without Tip Minimum:** hourly wages plus the employee's actual tips after tip-out.
- **With Tip Minimum:** those same earnings plus only the employee's allocated guarantee
  paycheck share, using the existing time-card distribution. A valid guest count
  is required. The extra-pay and earnings details appear only when the event
  falls below the minimum. When the minimum is met, only the green status
  remains, avoiding duplicate totals. The PDF saves one final earnings total.
  A green **Minimum met** message means no extra pay is needed; a red
  **Below minimum** message means extra pay is owed. This checks the event's
  actual combined tips against its $4-per-guest minimum, not hourly wages.
  No colored status is shown without a valid guest count.

Each section shows before-tax earnings, estimated tax, and estimated after-tax
earnings. The shared summary shows the employee's hours, hourly wages, and total
tips.
Both comparisons highlight effective hourly earnings (total earnings divided by
the employee's hours), before and after estimated tax. Daily totals before and after
estimated tax are the largest figures in the personal section. Hourly figures
are also included in the PDF receipt. These are earnings including tips, not
changes to the hourly wage. Estimated after-tax earnings for both accounts use
the same 20.75% effective withholding method from the supplied paystub, as
requested. The unrounded rate is used internally; tax and net
amounts round to cents. This includes cash already received and is not a paycheck
deposit estimate or an exact payroll tax calculation.

Each authorized employee's section offers **Save Earnings (PDF)**: a compact,
single-page printable
receipt with a TwoBirds heading, employee, today's local date, venue, hours,
and a large before-tax total. A short breakdown lists whole-dollar cash tips,
credit tips and wages to cents, and a paycheck guarantee only when the employee's
additional share is positive. Estimated after-tax earnings and effective
before-tax hourly earnings follow. There are no duplicate comparisons, guest
counts, or tax-rate explanations. Totals include the applicable guarantee and
cash tips already received; the footer identifies the estimate as not a paycheck
deposit. PDF text is selectable and vector-based for clear zooming and printing.
Downloads require the employee's positive hours and a venue and use current inputs,
without sending a receipt or uploading the record. Files are individual
snapshots, not an automatically maintained earnings history. PDF generation
runs locally without a production dependency, external font, or server call.
Browsers supporting file sharing (including supported iPhone Safari versions)
open the native share menu: choose **Save to Files**. Other browsers download
the PDF normally. A canceled or failed share offers **Download Instead** for a
fresh, user-initiated download. Sharing never automatically selects a recipient
or sends a receipt.

The profile is fetched only through authenticated login/session validation,
is not saved in drafts, and is cleared when the
session is cleared. Other accounts do not receive the profile. The updated
Apps Script deployment is required before this section can appear.

## Private earnings tracker (Will Schreiner only)

The backend offers the tracker only to Will Schreiner's PIN-authenticated
session. Every tracker request is checked on the server against a valid session
for that account; other managers, a staff row named "Will Schreiner", or values
changed in the browser cannot read or change the data. For other accounts the
backend returns no tracker flag and the page never creates the tracker controls.
(The page's public JavaScript source does contain the tracker code, as it does
the existing personal earnings code; the data itself is only served to Will.)

- **Save My Shift** (in Will's personal earnings section) saves the current
  shift: date, venue, wedding status, hours, hourly wages, cash tips, credit
  tips, and any tip minimum share. The server stores a $0 tip minimum for any
  shift not marked as a wedding. Shifts saved before wedding status existed keep
  their recorded earnings and show "Not recorded" until edited. Totals are recalculated on the server using the same rate,
  rounding, and estimated withholding as the calculator. The shift date defaults
  to today, and a shift saved before 3 AM counts toward the previous day.
- One shift is kept per date and venue. Saving again asks before replacing it.
  Shifts can be opened for a breakdown, edited (date, hours, tips, tip minimum),
  or deleted.
- Shifts are grouped into two-week pay periods starting Monday, Oct 12, 2026
  (Oct 12?25, Oct 26?Nov 8, and so on), in date order. The current period is
  shown by default; earlier periods remain available from the period menu and
  are never deleted automatically.
- Each period shows total hours, total before tax, total after estimated tax,
  and an **estimated paycheck deposit** (after-tax total minus cash tips already
  received). An optional actual paycheck amount can be saved and compared.
- Data is stored in a private Google Sheet, "TwoBirds Tipout - Private Earnings
  Tracker", that the Apps Script creates in the deploying (Will's) Google Drive
  on first use. It is not stored in the browser, so it persists across devices,
  browser restarts, and Reset.

To change the pay schedule, update `PAY_PERIOD_ANCHOR` (any period start date)
and `PAY_PERIOD_DAYS` in [google-apps-script.gs](google-apps-script.gs).

## Backend deployment

[google-apps-script.gs](google-apps-script.gs) handles manager PIN login,
session validation, and the private earnings tracker. After changing it, update
the existing Google Apps Script web app deployment to a new version so the URL
stays the same. If the deployment URL changes, update `BACKEND_ENDPOINT` in
[index.html](index.html).

## Verification

Requires Node.js 22+ for the PDF validation tooling:

```text
npm ci
npm test
```

Tests compile-check both production scripts, verify the role/hour allocations,
cash rounding and cent reconciliation, run the backend against an in-memory
spreadsheet to verify PIN login and tracker authorization, parse generated
PDFs for single-page content and totals, and exercise the real page in a
headless browser, including live inputs, drafts, reset, the tracker, and
320px/390px/720px layouts. Browser tests use an existing Chrome or Edge on Windows.
Elsewhere, run `npx playwright install chromium`, or set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an installed Chromium-based browser.
External requests are blocked or intercepted; tests do not contact the live
Apps Script backend. Live Apps Script deployment and spreadsheet
integration require separate verification after redeployment.
