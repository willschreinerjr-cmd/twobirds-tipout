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

## Save My Shift (Will Schreiner only)

Will's earnings history lives in a separate private app, **Will's Earnings**
(repository `wills-earnings`). The calculator only adds a **Save My Shift**
button and an **Open Will's Earnings** link to Will's personal earnings section;
it does not store or display earnings history.

- The backend offers this only to Will Schreiner's PIN-authenticated session.
  Other managers, a staff row named "Will Schreiner", or values changed in the
  browser cannot save shifts; other accounts never receive the button or the
  site link. (The page's public JavaScript contains the button code, as it does
  the personal earnings code; nothing private is served to other accounts.)
- Save My Shift sends the event inputs (tip pots, wedding status, guest count,
  venue, date, and time-card roles and hours, with coworkers' names replaced by
  placeholders). The backend recalculates Will's earnings with the same code as
  the page and the private wage and withholding profile, then writes the shift
  to Will's private earnings sheet in whole cents. Browser totals are not trusted.
- Each save carries an idempotency key; retrying an unchanged or failed save
  reuses it, so a shift is never stored twice. Separate events on the same day
  can be saved. If Will's Earnings is unavailable, the calculator keeps working,
  shows the error, and keeps all inputs for a retry.
- The shift date defaults to today; a shift saved before 3 AM counts toward the
  previous day. Pay periods, editing, and deleting are handled in Will's Earnings.

The backend reads Script Properties `WILLS_EARNINGS_SPREADSHEET_ID` (Will's
Earnings data sheet) and `WILLS_EARNINGS_URL` (the site link). Expired manager
sessions are pruned from Script Properties at each sign-in.

## Individually owned earnings trackers

Every PIN-authenticated manager can configure an optional **My Private Earnings**
link on the venue screen. Each manager creates and owns their own Google Apps
Script project and spreadsheet using the
[setup instructions](https://github.com/willschreinerjr-cmd/wills-earnings#setting-up-your-own-private-tracker).
The link is saved per manager in the current browser; it is not authentication.
Each tracker is accessible only through its owner's Google account.

After a shift, **Save My Shift** opens the manager's private tracker with their
date, venue, role, hours and allocated tips ready for review and confirmation.
It does not send their rates or earnings history to the shared backend.
The tracker stores their bartender and manager rates independently and uses
the current rate for new imports, without changing historical shifts. The
shift is temporarily in the browser URL fragment and can be accessible on a
shared device or through browser history or synchronization.
Will's existing direct-save button remains available separately.

## Backend deployment

[google-apps-script.gs](google-apps-script.gs) handles manager PIN login,
session validation, and Save My Shift. After changing it, update
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
spreadsheet to verify PIN login and Save My Shift authorization, parse generated
PDFs for single-page content and totals, and exercise the real page in a
headless browser, including live inputs, drafts, reset, Save My Shift, and
320px/390px/720px layouts. Browser tests use an existing Chrome or Edge on Windows.
Elsewhere, run `npx playwright install chromium`, or set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an installed Chromium-based browser.
External requests are blocked or intercepted; tests do not contact the live
Apps Script backend. Live Apps Script deployment and spreadsheet
integration require separate verification after redeployment.
