# Evaluation plan

This plan is written and committed before any evaluation run. The commit hash and time of this file show that the question, the data, the baseline and the success rule were fixed before any result existed. If something has to change after a run, the change goes under "Changes after the first run" with its reason, and the original lines stay as they were.

There are no real users in this evaluation. Nobody was recruited, messaged or contacted for it, and our own traffic counts as testing, never as usage.

## Question
<The one question the evaluation answers, in a sentence. If the project makes no measurable claim, write "n/a: <reason>" here and leave the rest of the plan as it is.>

## Metric and threshold
- Metric: <what is measured, and how it is computed>
- Threshold: <the value that counts as success>
- Interval: 95%, from `python3 evidence/interval.py` (Wilson for k of n, bootstrap for a mean or a difference)

## Data
- Dataset: <name, link and licence>
- Version or hash: <release, date, or the SHA-256 of the file the rerun downloads>
- Split: <by time where possible: the building slice and the test slice, with their dates. The test slice is never opened while building.>

## Baseline
- Whose: <a baseline someone else published, with a link, and its score on this split if they report one>

## Success rule
<The exact rule, decided now. For example: "the metric beats the baseline on the test slice, and the low end of its 95% interval is above the baseline's score.">

## Models and seeds
- Models: <"none", or "an AI model". The exact model name and version appear only where a submission form asks which AI tools were used.>
- Seeds: <every random seed the rerun uses>

## How results are reported
Every result names its kind at first mention, gives n, the source, the period and a 95% interval, and links its rerun command and commit. Measured numbers and estimates are kept apart, and failures are shown next to successes.

| Kind | Label at first mention | Travels with the number | Never used for this kind |
|---|---|---|---|
| Replay on public data | Back-test on public data (<dataset>, <years>) | n records, source and licence, period, whose baseline, 95% interval, rerun command and commit | `users`, `patients helped`, `customers`, `pilot`, `deployed with`, `proven`, `clinically validated` |
| Estimate from a replay | Estimate, not an observed result | the assumptions, and the data fields used to price it | `impact achieved`, `saved X hours for users`, `lives saved` |
| Real public system | Test transactions from wallets we control (addresses listed), or replayed in our own forks | counts, links, addresses | `users`, `volume`, `traction` |
| Break test | Our own break test (we tried to make it fail) | what we tried, how many attempts, what broke and what we fixed | `users`, `testers`, `validated` |

The README and the submission text open their evidence section with one line before any number:

> Evidence, stated plainly: no real users yet; it was built for this hackathon. Instead: <a back-test on <dataset> against <published baseline>>, <test transactions from wallets we control>, <our own break test of <the main claim>>. Each one reruns from the repo with one command.

Then one card per claim:

> Claim: <product> <does k of n <cases>> at <budget>.
> Evidence type: <label from the table above>, not real users.
> Data: <dataset, link, licence>, <period>, <n rows>. Baseline: <source> scores <x> on the same split.
> Result: <y> (95% interval <a> to <b>).
> Rerun: `<command>` at commit <hash>. Limits: <historical data, no live behaviour; any specific skew>.

Then a short limits paragraph, in numbers: zero real users, the interval, the data's years, and the next real test, with the metric and threshold that would change the conclusion.

## Changes after the first run
- 2026-11-18 ~15:10 IST, after the first scoring run (n=28: 11/28 openable, robot 4/11, random 2/11): fixed a measurement bug, not the rule. `World.openness` measured travel from the lower limit, but Lux3D returns many ranges as [-a, 0] with the closed pose at 0, so those parts read as "open" at rest and "closing" as they opened (13 of the 41 joints). Openness is now the share of travel from rest (0) toward the limit farther from 0, and the scripted pull opens toward that limit too. The test set, the 50% rule, the robot, the baseline and the seed are unchanged; the first run's CSV is kept as evidence/results-run1-bug.csv.
