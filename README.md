# TwoBirds Tipout

Event tip-out calculator hosted as a Google Apps Script web app. The public
GitHub Pages address redirects to the Google-account app. Static local previews
are for development only.

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

Managers sign in with their approved Google account and then enter the PIN
assigned to that account the first time. After activation, subsequent visits
use the approved Google account automatically. A PIN alone cannot unlock the deployed calculator or
save earnings. Managers without an approved account must be added by the app
owner before they can use it. Google may request sign-in or authorization
again; a permanent Google login cannot be guaranteed. The legacy PIN-only backend is disabled by default, including previously
issued sessions.

Selecting or changing a venue does not make any staff-loading requests. Staff
names and hours are entered manually. There is no Toast API integration or API
credential requirement.

## Personal daily earnings

Each approved manager enters their own bartender and shift manager hourly rates
once in the calculator. Rates are stored per Google account and can be changed
in My Private Earnings. Each personal earnings section uses only that manager's
named time cards, tips, and saved role rates.

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

## Private earnings

Each approved manager's Google account has its own spreadsheet and saved rates.
**Save My Shift** sends only that manager's shift details to the account-gated
earnings app. Existing shifts keep their original wages and rates. The app
owner controls the shared application code; keep Google accounts and devices
secure. Will's existing spreadsheet is linked rather than copied.

## Backend deployment

[google-apps-script.gs](google-apps-script.gs) is the retired legacy backend.
Its PIN-only login, session validation and shift writes fail closed unless
explicitly re-enabled for local compatibility testing; never re-enable them in
production. The Google-account app's backend lives in the earnings repository.

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
