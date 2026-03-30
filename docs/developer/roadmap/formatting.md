# Emergent Expression Formatting Roadmap

This document defines a staged roadmap for improving formatting support for Emergent expression files only:
- `.dla`
- `.dlp`

The goal is to move from the current whitespace-only formatter to a syntax-aware formatter that materially improves day-to-day editing without forcing a disruptive rewrite of existing files in early stages.

The recommended sequence is:
1. establish strong formatter tests around current behavior
2. move formatting onto the server with output intentionally close to the current client-side formatter
3. build richer formatting capability on top of shared parser/token/AST infrastructure

## Execution Status

### Current Block Status
- Block 1: Foundation and safety rails: in progress
- Block 2: Server-side formatter parity: completed
- Block 3: Syntax-aware formatting core: in progress
- Block 4: Block layout and multiline normalization: in progress
- Block 5: Selection formatting and range correctness: completed
- Block 6: Polish, hardening, and adoption: not started

### Last Completed Step
- Block 4 slice: extended parsed blank-line normalization into multiline additional-output continuation regions by collapsing repeated blank lines while preserving a single blank line on parser-owned continued target and obligation lines. Parsed multiline additional-output statements now follow the same owned-region blank-line rule already used for multiline `if` headers, declaration headers, `defaults`, invocation continuations, block bodies, and `end ->` continuation regions.
- Scope decision: this slice is limited to parse-success multiline additional-output continuation lines outside brace-block interiors and closes, matching the existing parser-owned indentation path for additional-output continuations. It does not change invocation/defaults spacing, brace-block interior blank-line policy, malformed recovery behavior, or broader multiline compression outside additional-output-owned continuation lines.
- Assumption: after invocation continuations, multiline additional-output continuations were the next smallest remaining family with equally explicit parser-owned ownership and established indentation behavior, so they were the last obvious continuation-family extension before Block 4 should stop broadening this blank-line-normalization thread.
- Lesson captured for future PRs: when two continuation families share the same brace-aware indentation boundaries, their blank-line normalization should usually converge on the same ownership limits before introducing new multiline compression policy elsewhere.
- Next-step implication: Block 4 should now move to a different narrow structural layout improvement rather than continuing generic continuation-family blank-line compression, unless a still-uncovered parser-owned region surfaces with equally explicit ownership and user-visible payoff.
- Block 4 slice: extended parsed blank-line normalization into multiline invocation continuation regions for `sub`, `host`, and `join` by collapsing repeated blank lines while preserving a single blank line on parser-owned continuation lines. Parsed multiline invocations now follow the same owned-region blank-line rule already used for multiline `if` headers, declaration headers, `defaults` continuations, block bodies, and `end ->` continuation regions.
- Scope decision: this slice is limited to parse-success multiline invocation continuation lines outside brace-block interiors and closes, matching the existing parser-owned indentation path for invocation continuations. It does not change additional-output continuation spacing, brace-block interior blank-line policy, malformed recovery behavior, or broader multiline statement compression outside invocation-owned continuation lines.
- Assumption: after `defaults`, multiline invocation continuations were the next smallest continuation family with equally explicit parser-owned ownership and established indentation behavior, so they were a safer continuation of Block 4 than broadening into all remaining continuation forms at once.
- Lesson captured for future PRs: when a multiline statement family already has explicit continuation ownership plus brace-boundary exclusions in indentation, blank-line normalization should reuse those same ownership and stop conditions instead of inventing a flatter line-range rule.
- Next-step implication: the next Block 4 slice should only continue this blank-line-normalization thread if another continuation family has equally explicit parser-owned boundaries, most likely additional-output continuations; otherwise Block 4 should move to a different narrow structural layout improvement.
- Block 4 slice: extended parsed blank-line normalization into multiline `defaults` continuation regions by collapsing repeated blank lines while preserving a single blank line. Parsed `defaults` entries now follow the same owned-region blank-line rule already used for multiline `if` headers, declaration headers, block bodies, and `end ->` continuation regions.
- Scope decision: this slice is limited to parse-success multiline `defaults` continuation regions. It does not change malformed recovery behavior, invocation/additional-output continuation spacing, or broader multiline statement policy outside parser-owned `defaults` entries.
- Assumption: after closing the parser-owned multiline header regions, multiline `defaults` continuations were the smallest remaining statement family with equally explicit ownership and existing indentation policy, so they were a safer continuation of Block 4 than broadening into all statement continuations at once.
- Lesson captured for future PRs: blank-line normalization should move one parser-owned statement family at a time; even when continuation shapes look similar, each family needs its own explicit acceptance of what counts as an owned multiline region.
- Next-step implication: the next Block 4 slice should only continue this blank-line-normalization thread if another continuation family has equally explicit parser-owned boundaries; otherwise Block 4 should shift to a different narrow structural layout improvement.
- Block 4 slice: extended parsed blank-line normalization into multiline `job` / `def` header continuation regions by collapsing repeated blank lines while preserving a single blank line. Parsed declaration headers now follow the same owned-region blank-line rule already used for multiline `if` headers, block bodies, and `end ->` continuation regions.
- Scope decision: this slice is limited to parse-success multiline `job` / `def` header continuation regions before the owned body start. It does not change malformed recovery behavior, declaration-body spacing, or general multiline declaration wrapping beyond the already parser-owned header slice.
- Assumption: once multiline declaration headers already had parser-backed ownership and canonical indentation, collapsing only the second-and-later blank lines inside that owned header region was the smallest coherent Block 4 counterpart to the preceding multiline `if` header slice.
- Lesson captured for future PRs: when two statement families share the same owned multiline-header shape, blank-line normalization should usually be closed symmetrically across both before introducing broader layout policy elsewhere.
- Next-step implication: the next Block 4 slice should only continue blank-line normalization if another multiline region has equally explicit parser-owned boundaries; otherwise the roadmap should move to a different narrow structural layout gap.
- Block 4 slice: extended parsed blank-line normalization into multiline `if` header continuation regions by collapsing repeated blank lines before a standalone `then` while preserving a single blank line. Parsed multiline headers now follow the same “obvious owned region only” blank-line rule already used for block bodies and `end ->` continuation regions.
- Scope decision: this slice is limited to parse-success multiline `if` header continuation regions before a standalone `then`. It does not change same-line `if ... then` headers, blank-line policy inside malformed recovery, or general multiline expression wrapping outside parser-owned `if` headers.
- Assumption: once parsed `if` headers already had canonical indentation and explicit ownership up to `then`, collapsing only the second-and-later blank lines inside that owned header slice was a smaller and more coherent Block 4 step than continuing to chase weaker delimiter-adjacent whitespace cases.
- Lesson captured for future PRs: when a multiline syntax region already has stable parser-owned indentation, the next safe normalization step is often to reuse the existing “preserve one blank line, delete the rest” rule inside that same region instead of inventing a new delimiter-specific heuristic.
- Next-step implication: the next Block 4 slice should prefer another parser-owned multiline region with similarly explicit ownership, or else pause Block 4 blank-line work rather than broadening into ambiguous whitespace compression.
- Block 4 slice: extended parsed `if` blank-line normalization to collapse blank lines between standalone comment groups and a following multiline `end ->` delimiter. Parsed comment groups that annotate trailing target ownership now stay visually attached to the `end ->` boundary instead of preserving spacer blank lines that weaken that association.
- Scope decision: this slice is limited to parse-success `if` regions and only to standalone comment groups immediately above a parsed multiline `end ->` delimiter. It does not change continuation-body blank-line policy after `end ->`, top-level blank-line behavior, or comment attachment outside parser-owned `if` delimiter boundaries.
- Assumption: once the formatter already treated comments above `else` and bare `end` as delimiter-adjacent structure, the matching parsed `end ->` case was the next smallest obvious ownership-preserving cleanup because those comments most naturally describe the trailing-target boundary line itself.
- Lesson captured for future PRs: delimiter-adjacent comment-attachment rules can stay low-risk when they extend one parser-owned boundary family at a time, instead of trying to generalize blank-line compression across every `end`-shaped line in one step.
- Next-step implication: the next Block 4 slice should target another explicit parser-owned delimiter/body adjacency case only if it has similarly clear ownership; otherwise Block 4 should move to a different narrow parsed-layout gap rather than broadening blank-line compression heuristics.
- Block 4 slice: extended parsed `if` blank-line normalization to collapse blank lines between standalone comment groups and the following `else` or bare `end` delimiter. Parsed delimiter-adjacent comments now stay visually attached to the `if` boundary they annotate instead of preserving a spacer blank line that weakens that relationship.
- Scope decision: this slice is limited to parse-success `if` regions and only to standalone comment groups immediately above `else` or bare `end`. It does not change `end ->` continuation spacing, top-level blank-line policy, or comment attachment outside parser-owned `if` delimiter boundaries.
- Assumption: when a standalone comment group sits directly above `else` or bare `end`, preserving one or more blank lines between that comment and the delimiter is weaker than treating the comment as delimiter-adjacent structure, so deleting those spacer blank lines is a low-churn Block 4 improvement.
- Lesson captured for future PRs: blank-line normalization near parsed delimiters can stay predictable when it is framed as comment attachment to a specific owned boundary, rather than as a broad “compress whitespace everywhere near control flow” rule.
- Next-step implication: the next Block 4 slice should target another narrow parsed-region layout gap, most likely a bare `end` / `end ->` adjacency rule or another delimiter-adjacent blank-line case with similarly explicit ownership.
- Block 5 slice: concluded the range-formatting contract by naming it explicitly as a non-cascading owned-slice policy and extending nested regressions to cover both backward and forward delimiter-adjacent expansions. Range formatting now documents that the touched-line window is the hard boundary for slice promotion, even when the selected inner slice sits inside a larger `if`.
- Scope decision: this slice does not add any new owned-slice expansion cases. It locks the existing `then` / `else` / bare `end` / multiline `end ->` and first-owned-line rules behind an explicit non-cascading contract, with nested coverage for both inner `else` bodies and inner multiline `end ->` delimiter slices. Document-formatting behavior is unchanged.
- Assumption: after the earlier owned-slice rules and the first non-cascading regression were already in place, the smallest final Block 5 step was to conclude the contract rather than search for one more boundary case whose value had not been demonstrated.
- Lesson captured for future PRs: a range-formatting block can be considered complete once the expansion rules, non-expansion boundaries, and anti-cascade stop condition are all explicit in both helper naming and regression coverage.
- Next-step implication: the next formatter PR should move back to Block 4 or Block 6 work rather than reopening Block 5 without a concrete failing selection case.
- Block 5 slice: hardened the current owned-slice contract so expansion rules trigger only from the originally touched lines, not from lines that were added by an earlier range-expansion step. Range formatting now makes that “no cascading into enclosing slices” policy explicit in the server helper, with nested-range regressions that keep an inner structural slice from growing into its enclosing `if`.
- Scope decision: this slice does not add a new owned-slice rule. It keeps the existing standalone-delimiter and first-owned-line promotions, but freezes them as non-cascading expansions rooted only in the user’s touched lines. Document-formatting behavior is unchanged.
- Assumption: after the narrow `then` / `else` / bare `end` / multiline `end ->` and first-owned-line rules were in place, the smallest reviewable next step was to codify their stop condition instead of adding another boundary case that would risk drifting toward enclosing-unit expansion.
- Lesson captured for future PRs: once a range-formatting policy depends on multiple small structural promotions, the contract must specify not just what expands, but also that newly expanded lines do not themselves become triggers for broader expansion.
- Next-step implication: the next Block 5 slice should make the final decision on whether any remaining concrete partial-selection case still justifies a new nearest-boundary rule, or whether Block 5 should conclude with the current non-cascading owned-slice contract.
- Block 5 slice: extended owned-slice expansion to the first `then`-body content line by promoting a selected first body line backward to the nearest `then` boundary line, whether that boundary is same-line `if ... then` or a standalone `then`. Range formatting now treats the first selected then-body line together with its leading blank/comment suffix and the nearest `then` boundary as one small structural then slice instead of formatting only the touched body line.
- Scope decision: this slice is limited to the first then-body content line whose nearest preceding owned boundary contains `then`. Later then-body content lines remain line-bounded, the selection does not expand to the full enclosing `if`, and document-formatting behavior is unchanged.
- Assumption: after the first else-body and first multiline `end ->` continuation-content rules, the most defensible remaining owned-slice promotion is the matching first then-body content line, because it has the same “first body line without its boundary” weakness while still avoiding enclosing-unit expansion.
- Lesson captured for future PRs: when a construct has both same-line and standalone boundary forms, a narrow owned-slice rule can still stay reviewable if both forms map to the same first-body-line contract and later body lines are locked down as line-bounded.
- Next-step implication: the next Block 5 slice should make a final decision about whether any concrete partial-selection case still merits another first-owned-line rule or whether Block 5 should conclude with the current narrow contract.
- Block 5 slice: extended owned-slice expansion to the first `else`-body content line by promoting a selected first body line backward to the standalone `else` delimiter it still belongs to. Range formatting now treats the first selected else-body line together with its leading blank/comment suffix and standalone `else` line as one small structural else slice instead of formatting only the touched body line.
- Scope decision: this slice is limited to the first else-body content line whose nearest preceding owned boundary is a standalone `else` delimiter. Later else-body content lines remain line-bounded, the selection does not expand to the full enclosing `if`, and document-formatting behavior is unchanged.
- Assumption: after the formatter already handled standalone `else` and the first multiline `end ->` continuation content line, the next smallest worthwhile owned-slice promotion is the matching first `else`-body content line, because leaving that line without its delimiter prefix is similarly weak while still avoiding enclosing-unit expansion.
- Lesson captured for future PRs: a non-delimiter line can safely inherit its nearest delimiter boundary when the rule is explicitly capped at the first owned content line and backed by regression tests for the next line that should not expand.
- Next-step implication: the next Block 5 slice should decide whether any remaining concrete partial-selection case still deserves another first-owned-line rule or whether Block 5 should conclude with the current narrow contract.
- Block 5 slice: documented and codified the stopping point for multiline `end ->` continuation-content expansion. Range formatting now treats only the first continuation content line as eligible to pull in the multiline `end ->` delimiter prefix; later continuation content lines remain line-bounded, with regression coverage for both direct and comment-separated continuation cases.
- Scope decision: this slice does not add another owned-slice expansion rule. It freezes the current `end ->` continuation policy at the first continuation content line, leaves later continuation lines line-bounded, does not change same-line `end -> result` behavior, and does not alter document-formatting behavior.
- Assumption: after promoting the first continuation content line to its delimiter prefix, broadening that same rule to later continuation lines would be a materially larger step toward enclosing-unit selection behavior, so the smaller reviewable move is to document and test the stop point explicitly.
- Lesson captured for future PRs: once an owned-slice expansion rule is introduced for the first line in a structural region, explicit tests for the next line that does not expand are necessary to keep the rule from drifting into an accidental enclosing-unit policy.
- Next-step implication: the next Block 5 slice should decide whether any remaining concrete partial-selection case still has enough user value to justify another owned-slice rule, or whether Block 5 should now conclude with the current narrow contract.
- Block 5 slice: extended range expansion to the matching multiline `end ->` continuation-content case by promoting a selected first continuation content line backward to the `end ->` delimiter it still belongs to. Range formatting now treats the first selected continuation target together with its leading blank/comment suffix and multiline `end ->` delimiter as one small structural continuation slice instead of formatting only the touched continuation line.
- Scope decision: this slice is limited to the first multiline `end ->` continuation content line whose nearest preceding owned boundary is a multiline `end ->` delimiter. It does not expand same-line `end -> result` selections, does not jump backward across another nontrivia content line, does not expand to the full enclosing `if`, and does not change document-formatting behavior.
- Assumption: once multiline header-content selection gained its standalone `then` suffix, the next smallest worthwhile non-delimiter counterpart is the first continuation-content line after a multiline `end ->` delimiter, because leaving that line without its delimiter prefix is similarly weak but still narrower than general enclosing-unit expansion.
- Lesson captured for future PRs: owned-slice expansion can broaden safely beyond standalone delimiters when it remains anchored to the nearest concrete syntax boundary and refuses to cross another content line.
- Next-step implication: the next Block 5 slice should decide whether any remaining concrete partial-selection case still needs owned-slice promotion or whether the formatter should stop here short of a general enclosing-unit policy.
- Block 5 slice: extended range expansion to the first concrete non-delimiter partial-selection case by promoting a selected multiline `if` header content line forward to the standalone `then` suffix it still owns. Range formatting now treats a selected multiline header continuation together with its trailing blank/comment suffix and standalone `then` line as one small structural header slice instead of formatting only the touched content line.
- Scope decision: this slice is limited to multiline `if` header content lines that have a standalone `then` ahead of them. Same-line `if ... then` headers remain line-bounded, the selection does not expand to the full enclosing `if`, and document-formatting behavior is unchanged.
- Assumption: leaving a selected multiline header continuation line without its trailing standalone `then` suffix is the first remaining partial-selection case weak enough to justify moving beyond the previously documented standalone-delimiter contract, while still keeping the policy narrower than general enclosing-unit expansion.
- Lesson captured for future PRs: once delimiter-adjacent expansion is stable, the next safe broadening step is to promote a non-delimiter line only when it has a nearby concrete syntax boundary that clearly completes the same owned slice.
- Next-step implication: the next Block 5 slice should decide whether any other concrete partial-selection case deserves the same owned-slice treatment or whether the formatter should stop here short of a general enclosing-unit policy.
- Block 5 slice: documented and codified the current range-expansion contract as stopping at the standalone `if` delimiter rules already implemented (`then`, `else`, bare `end`, and multiline `end ->`). Range formatting now has explicit regression coverage for what expands and what intentionally remains line-bounded, instead of leaving the policy implied by a growing set of delimiter-specific helpers.
- Scope decision: this slice does not introduce enclosing-unit expansion. Multiline `if` header content lines and same-line `if ... then` headers remain line-bounded, while only the current standalone delimiter forms promote the selection to their nearest owned slice. Document-formatting behavior is unchanged.
- Assumption: after closing the obvious standalone `if` delimiter cases, the smallest reviewable next step is to freeze and document the current contract rather than broaden selection formatting into whole-construct expansion without stronger evidence that the remaining gaps are worth the added churn.
- Lesson captured for future PRs: once a narrow structural selection policy exists, explicit non-expansion tests are as important as expansion tests because they keep the contract stable and prevent accidental drift toward a broader formatter model.
- Next-step implication: the next Block 5 slice should only pursue enclosing-unit selection expansion if a concrete remaining partial-selection case shows that the documented standalone-delimiter contract is insufficient in practice.
- Block 5 slice: clarified the standalone `then` delimiter-adjacent selection rule by expanding a range that touches a standalone `then` line backward to include the immediate multiline-header suffix above it. Range formatting now treats `then` together with the nearest owned header-prefix slice as a small structural unit instead of formatting only the delimiter line in isolation.
- Scope decision: this slice is limited to standalone `then` lines in multiline `if` headers. It expands only backward through blank/comment suffix lines to the first preceding content line, does not expand to the whole enclosing `if`, does not alter same-line `if ... then` headers, and does not change document-formatting behavior.
- Assumption: a selected standalone `then` line is not useful in isolation when the immediately preceding multiline-header suffix remains untouched, so the smallest worthwhile next step is the backward counterpart to the existing `else`, bare `end`, and multiline `end ->` rules rather than a jump to full enclosing-unit expansion.
- Lesson captured for future PRs: the narrow delimiter-expansion policy still composes coherently when each delimiter promotes only its nearest clearly owned slice, so the decision to broaden into enclosing-unit formatting can stay deferred until a real gap remains after the obvious delimiter cases are closed.
- Next-step implication: the next Block 5 slice should decide whether the remaining structural partial-selection cases justify a documented enclosing-unit policy or whether the formatter should explicitly codify that standalone delimiter promotion stops with the current `if`-delimiter set.
- Block 5 slice: clarified the `end ->` delimiter-adjacent selection rule by expanding a range that touches a multiline `end ->` line forward to include the immediate owned continuation prefix. Range formatting now treats an `end ->` delimiter together with its first continuation slice as a small structural unit instead of formatting only the delimiter line in isolation.
- Scope decision: this slice is limited to `end ->` lines that clearly signal multiline continuation ownership today, specifically newline-arrow and trailing-comma forms. It expands only through blank/comment prefix lines up to the first continuation content line, does not change complete single-line `end -> result` selections, does not expand to the whole enclosing `if`, and does not alter document-formatting behavior.
- Assumption: the smallest worthwhile counterpart to the existing `else` rule is to promote only obviously multiline `end ->` selections, because expanding every `end ->` line would incorrectly capture unrelated following statements when the target list is already complete on the same line.
- Lesson captured for future PRs: delimiter-adjacent range expansion can stay low-risk when it keys off concrete continuation signals instead of treating every delimiter form as structurally incomplete by default.
- Next-step implication: the next Block 5 slice should decide whether structural delimiter selections should keep accumulating narrow per-delimiter rules or whether the roadmap should switch to a documented enclosing-unit policy for partial selections inside larger constructs.
- Block 5 slice: clarified the matching bare `end`-adjacent selection rule by expanding a range that touches a standalone `end` line backward to include the immediate owned suffix above it. Range formatting now treats a bare `end` together with its trailing body/comment suffix as a small structural unit instead of formatting only the delimiter line in isolation.
- Scope decision: this slice is limited to standalone bare `end` selections and expands only backward through blank/comment suffix lines to the first preceding content line. It does not special-case `end ->` continuation lines yet, does not expand to the whole enclosing construct, and does not alter document-formatting behavior.
- Assumption: a selected bare `end` line is not useful in isolation when the immediately preceding body/comment suffix remains untouched, so this backward expansion is the smallest worthwhile counterpart to the prior `else`-line rule.
- Lesson captured for future PRs: delimiter-line range expansion should follow the smallest owned slice in the natural direction of the syntax boundary, which may be forward for `else` and backward for bare `end`.
- Next-step implication: the next Block 5 slice should decide whether `end ->` continuation lines deserve a similar forward expansion rule or whether the roadmap should jump to a more general enclosing-unit policy decision.
- Block 5 slice: clarified the first delimiter-adjacent structural selection rule by expanding a range that touches a standalone `else` line to include the immediate else-body prefix. Range formatting now treats `else` plus its first owned body prefix as a small structural unit instead of formatting only the delimiter line in isolation.
- Scope decision: this slice is limited to standalone `else` line selections and expands only through blank/comment prefix lines up to the first else-body content line. It does not expand to the entire enclosing `if`, does not special-case `end` lines yet, and does not alter document-formatting behavior.
- Assumption: formatting a selected `else` line without any of its owned body prefix is too weak to be useful, so this small expansion rule is a better first delimiter-adjacent Block 5 policy than jumping straight to full enclosing-unit expansion.
- Lesson captured for future PRs: structural range expansion can be introduced incrementally by promoting single delimiter lines to the smallest meaningful owned slice instead of forcing an all-or-nothing decision about enclosing-unit formatting.
- Next-step implication: the next Block 5 slice should clarify the matching `end`-adjacent case or another narrow structural selection rule, rather than broadening immediately to whole-construct expansion.
- Block 5 slice: extended touched-line range normalization to exclude an untouched leading line when a multi-line selection starts at the end of that line. Range formatting now trims both kinds of off-by-one line-boundary surprises: trailing lines ended at column 0 and leading lines entered only at end-of-line.
- Scope decision: this slice is limited to multi-line range-boundary normalization for untouched leading lines, plus regression coverage for the server helper and integration fixture path. It does not change same-line zero-width selection behavior, expand selections to enclosing syntax units, or alter document-formatting behavior.
- Assumption: completing the leading-line counterpart to the previous trailing-line fix is the smallest high-value Block 5 follow-up before deciding whether any ranges should expand beyond the touched lines model.
- Lesson captured for future PRs: range-boundary normalization works best when leading and trailing untouched-line rules are treated symmetrically, so future selection-policy changes should evaluate both sides of the range together.
- Next-step implication: the next Block 5 slice should move beyond raw line-boundary cleanup and clarify a delimiter-adjacent structural selection rule, most likely partial selections that start/end inside lines like `else` or `end`.
- Block 5 slice: started selection-formatting correctness by defining range formatting as line-bounded over the lines actually touched by the selection. A range that ends at column 0 on a later line now formats through the previous line instead of unexpectedly pulling in the untouched trailing line, and the integration fixtures now cover partial-line range selections explicitly.
- Scope decision: this slice is limited to range-boundary normalization at the server formatting entrypoint plus fixture support for partial-line selection coordinates. It does not change the formatter’s existing line-bounded policy for touched lines, expand selections to enclosing syntax units, or alter document-formatting behavior.
- Assumption: the smallest high-value Block 5 step is to remove the surprising “trailing untouched line gets formatted” case before deciding whether future range formatting should stay line-bounded or expand to enclosing constructs.
- Lesson captured for future PRs: range-format correctness can improve without reopening formatter policy by normalizing editor selection coordinates before they enter the syntax-aware formatting pipeline.
- Next-step implication: the next Block 5 slice should clarify another line-bounded selection edge, most likely partial selections that start/end inside delimiter-adjacent structural lines or a documented decision about whether some ranges should expand to enclosing syntactic units.
- Block 4 slice: extended parse-success `if` closure layout so bare `end` delimiters are found and aligned even when the parser range stops at the last branch statement, and excessive blank-line runs immediately before those bare `end` lines now collapse to a single blank line. This applies to document formatting and range formatting when the selected range fully covers the affected parsed `if` slice.
- Scope decision: this slice is limited to parser-owned bare `if ... end` closure boundaries. It does not change malformed recovery behavior, broaden declaration `end` policy, or introduce general blank-line normalization outside parsed `if` delimiter regions.
- Assumption: nested `if` blocks with bare `end` delimiters are common enough in normal editing that fixing delimiter alignment and the adjacent blank-line suffix is still core Block 4 work, not tail-end edge-case polish.
- Lesson captured for future PRs: parse-success formatter logic cannot assume AST ranges include delimiter lines, so delimiter lookup for layout policy should follow the concrete syntax boundary in the document when the parser node stops at the last owned body statement.
- Next-step implication: the next Block 4 slice should stay focused on another obvious parsed-region boundary rule, most likely a comment-aware `else` adjacency case or another narrow delimiter-adjacent blank-line normalization step.
- Block 4 slice: extended parsed block-layout normalization to collapse excessive blank-line runs inside parse-success `if` trailing `end ->` continuation regions while preserving a single blank line. This now applies when a parsed `if` owns multiline trailing targets after `end -> ...`, for both document formatting and range formatting when the selected range fully covers the affected continuation slice.
- Scope decision: this slice is limited to parser-owned `if` trailing `end ->` continuation regions. It does not broaden malformed recovery behavior, top-level statement spacing, standalone blank-line policy immediately before a bare `end`, declaration `end` policy beyond existing body handling, or general blank-line normalization outside parser-owned `if` continuation ownership.
- Assumption: once an `if`’s `end -> ...` line already owns its continuation indentation structurally, collapsing only the second-and-later blank lines inside that owned continuation region is an obvious low-churn Block 4 cleanup.
- Lesson captured for future PRs: delimiter-adjacent blank-line policy can often be introduced safely by following existing parser-owned continuation regions first, instead of trying to solve every surrounding `end` spacing case in one PR.
- Next-step implication: the next Block 4 slice should keep targeting another obvious parsed-region layout gap, most likely a standalone `else` / bare `end` adjacency case with comments or blank lines, before moving on to broader block-spacing policy.
- Block 4 slice: started block-layout normalization by collapsing excessive blank-line runs inside explicitly parsed block bodies while preserving a single blank line. This now applies to parse-success `job` / `def` bodies, `if` branch bodies, and brace-block interiors, and works for both document formatting and range formatting when the selected range fully covers the affected block slice.
- Scope decision: this slice is limited to parsed explicit body/interior regions where ownership is unambiguous and where extra blank lines can be deleted without guessing. It does not normalize blank lines in malformed recovery mode, top-level statement spacing, multiline header/target continuation regions, or broader blank-line policy around `else` / `end` boundaries.
- Assumption: collapsing only the second-and-later blank lines inside explicitly parsed block bodies is an “obvious case” under Block 4 that improves readability without introducing disruptive style churn.
- Lesson captured for future PRs: once the formatter starts making structural deletion edits, range-format expectations need to be scoped to fully selected structural slices rather than assuming later delimiters outside the selection will also be realigned.
- Next-step implication: the next Block 4 slice should stay focused on another obvious block-layout normalization rule with clear user-visible payoff, most likely surrounding blank-line handling near `else` / `end` boundaries or another narrow multiline-body layout rule, instead of reopening parse-ownership work.
- Block 3 slice: extended parse-success declaration-header ownership for `def` headers whose first target starts on the line after `)`, including standalone comment-separated continuation lines before `:`. This closes the remaining newline-start header-target asymmetry between `job` and `def`, so those lines now stay inside the parsed `def` header instead of leaking into the body.
- Scope decision: this slice is limited to parser-backed ownership for newline-start multiline `def` header targets plus formatter-model/output regression coverage that locks in the existing low-disruption indentation for those parsed lines. It does not broaden malformed recovery behavior, declaration-body indentation policy, or general declaration layout.
- Assumption: `def` headers should share the same newline-start target ownership rules already accepted for `job` headers, so aligning their parser behavior is lower risk than introducing formatter-side correction for the old `def` body leakage.
- Lesson captured for future PRs: declaration-header parsing gaps can remain hidden when formatter indentation coincidentally matches both interpretations, so parser/model assertions are necessary even when document-format output changes are intentionally minimal.
- Next-step implication: the remaining declaration-focused Block 3 work should now move past header-target parsing and focus on a declaration-adjacent ownership or layout slice with clearer formatter-surface impact, most likely a body-adjacent standalone comment gap or another explicitly parser-owned declaration subregion.
- Block 3 slice: extended parse-success declaration-header ownership for multiline `def` targets so newline continuations after the parameter list, including standalone comment-separated target continuation lines before `:`, remain inside the parsed `def` header instead of leaking into the body. This keeps the formatter input model aligned with the existing parsed declaration-header indentation path without introducing a broader style-policy change.
- Scope decision: this slice is limited to parser-backed ownership for multiline `def` header targets plus formatter-model/output regression coverage that locks in the current low-disruption indentation for those parsed lines. It does not broaden malformed recovery behavior, change declaration-body indentation policy, or introduce new layout rules beyond the existing declaration-header indentation path.
- Assumption: multiline `def` header targets should follow the same newline-continuation ownership rules already accepted for multiline `job` header targets, so extending that parser behavior is lower risk than adding new formatter heuristics on top of the old `def` body leakage.
- Lesson captured for future PRs: declaration-header ownership is still asymmetric unless `job` and `def` share the same continuation rules, so parser-backed header slices should be closed before attempting broader declaration comment/layout policy.
- Next-step implication: the remaining declaration-focused Block 3 work should target another parser-owned comment/layout gap with visible formatting consequences, most likely a declaration-body-adjacent comment ownership slice rather than more `def` header target parsing.
- Block 3 slice: extended parsed standalone comment attachment to multiline invocation continuations for `sub`, `host`, and `join`, including continuations that flow from multiline arguments into newline-after-`->` targets or braced obligations. This required a small parser lookahead fix so comment-separated newline runs before the first continued target or first braced obligation stay inside the same parse-success statement ownership boundary, after which parsed invocation continuation lines propagate their owned indentation to directly adjacent standalone `//` comment groups the same way already-supported parsed multiline `defaults`, `if`, and additional target/obligation continuations do.
- Scope decision: this slice is limited to parse-success standalone comment attachment for parser-owned multiline invocation continuation lines plus the parser lookahead needed to preserve that ownership across comment-separated newline runs before the first continued target or first braced obligation. It does not broaden malformed recovery ownership, inline comment handling, declaration-body/body-adjacent blank-line policy, or general multiline layout normalization.
- Assumption: multiline invocation continuation lines already have sufficiently explicit parser ownership that adjacent standalone `//` groups should inherit the same continuation indent without adding new formatter-side heuristics.
- Lesson captured for future PRs: once a statement family already owns its continuation lines structurally, extending standalone comment indentation can usually remain a formatter-side ownership propagation change instead of requiring further parser recovery work.
- Next-step implication: the remaining Block 3 comment-attachment work should now focus on parser-owned multiline slices that still lack explicit standalone comment propagation, rather than revisiting invocation continuations.
- Block 3 slice: added parser-backed support for multiline `defaults` continuation gaps caused by standalone comment lines, and extended parsed `defaults` formatting coverage across that newly owned region. Parsed multiline `defaults` entries now keep comment-separated continuation lines inside the same statement ownership boundary, so directly adjacent standalone comment groups indent to the same continuation depth as the owned entries.
- Scope decision: this slice is limited to the parser-backed `defaults` continuation gap plus formatter coverage for standalone `//` comment groups directly adjacent to parser-owned multiline `defaults` continuation lines. It does not yet expand comment attachment to declaration bodies, inline comments, malformed recovery ownership, broader blank-line policy, or the still-unowned gap where a standalone comment appears between a newline-after-`->` line and the first braced obligation opening.
- Assumption: existing `.dla` / `.dlp` files may still have inconsistent continuation indentation, so the formatter should only normalize standalone comment lines where parser ownership is explicit instead of guessing across ambiguous multiline layouts.
- Lesson captured for future PRs: the parsed comment-attachment helper composes cleanly with existing continuation ownership when each slice reuses already-owned continuation lines instead of broadening attachment rules globally.
- Lesson captured for future PRs: parser ownership boundaries differ not just across statement families but within declaration subregions, so each comment-attachment slice should be validated against real parse-success inputs before extending the same policy to another owner family.
- Lesson captured for future PRs: when line comments are lexed away into newline tokens, parser ownership gaps can often be closed by tightening continuation lookahead rather than adding formatter-side heuristics.
- Scope decision carried forward: parsed declaration-body indentation already covers nonblank body comment lines, so declaration-body attachment was deferred in favor of this parser-backed gap that still blocked parse-success ownership.
- Validation lesson captured for future PRs: `npm test` exercises the bundled extension artifacts (`client/dist/extension.js` and `server/dist/server.js`), so formatter changes may require rebuilding the relevant bundle before integration results reflect current source edits.

### Next Recommended PR
- Block 4: shift to a different narrow structural layout improvement instead of continuing generic continuation-family blank-line compression; only reopen this thread if another parser-owned multiline region with equally explicit ownership shows clear user-visible payoff.
- Keep broad multiline layout, blank-line normalization, and general line-wrapping policy deferred until the formatter has explicit ownership rules for the remaining continuation-heavy statement forms and non-brace boundaries.

### Roadmap Update Rule
- Each roadmap PR should update this section.
- Mark completed work precisely and name the next recommended PR-sized slice.
- If implementation choices narrow or expand scope, record that decision here before finalizing the PR.

## Current State
- Formatting is implemented server-side in [server/src/formatting.ts](/mnt/c/Users/pchandle/Documents/git/vscode-ec-language-extension/server/src/formatting.ts).
- Current behavior is intentionally small in scope:
  - collapse repeated spaces in many non-comment contexts
  - normalize comma spacing
  - normalize `->` spacing
  - trim trailing whitespace
- Full-line `//` comments are skipped.
- Formatting is not parse-aware and does not use expression structure to decide indentation, line wrapping, or block layout.
- `Format Document`, `Format Selection`, and VS Code `formatOnSave` therefore provide only light cleanup rather than layout normalization.

## Goals
- Improve editing productivity for `.dla` and `.dlp` files.
- Keep early stages minimally disruptive so developers can adopt formatting without large noisy diffs.
- Base later formatting decisions on language structure rather than regex-only transforms.
- Keep formatting behavior deterministic and testable.
- Make contribution boundaries clear so multiple PRs can advance formatting without drifting in style or architecture.

## Non-Goals
- Formatting `.cspec`, `.pspec`, `.pdes`, or `.pdd` files.
- Reworking general language-server navigation and refactoring features in this roadmap.
- Introducing broad style customization before the formatter has a stable default policy.
- Hand-editing generated assets as part of formatting work.

## Formatting Principles
- Prefer predictable output over clever heuristics.
- Prefer stable, repeatable transforms over context-sensitive guesses.
- Preserve user intent in early stages where layout is ambiguous.
- Avoid formatting changes that alter language semantics.
- Avoid style churn: once a rule is introduced, it should remain stable unless there is a clear correctness or usability issue.
- Treat comments as first-class syntax to preserve positioning and readability.

## Architectural Direction

### Near-Term Direction
- Use the current client-side formatter only as a temporary baseline and compatibility reference.
- Prioritize moving formatting behavior to the server early, even if the first server-side implementation is intentionally minimal.
- Continue exposing formatting through VS Code document/range formatting providers so `Format Document`, `Format Selection`, and `formatOnSave` keep working.
- Keep the client as thin transport and registration code once the server-side path exists.

### Target Direction
- Move formatting logic to a server-side syntax-aware implementation backed by the parser used by the language tooling.
- Prefer sharing parser/token infrastructure with the server so diagnostics and formatting operate on the same structural understanding.
- Separate formatting into explicit layers:
  - parse and recover
  - compute formatting decisions
  - emit edits
- Keep formatting policy isolated from VS Code transport code so behavior can be unit-tested without an editor host.

### Recommended Migration Strategy
- Do not invest heavily in expanding the client-side formatter.
- First, migrate formatting to the server with behavior intentionally close to the current formatter:
  - repeated-space cleanup in safe contexts
  - comma spacing normalization
  - `->` spacing normalization
  - trailing whitespace trimming
  - conservative comment preservation
- Treat that first server-side formatter as an architecture migration, not as a style-policy expansion.
- After parity is stable and tested, expand syntax-aware behavior in small slices using shared AST/token work.
- Do not port the current regex formatter mechanically if parser/token data can already express the same decisions more safely.

### Contribution Guardrails
- Do not add new regex rules if the same behavior should be driven by syntax and the parser already has the needed information.
- Do not mix style-policy changes with unrelated diagnostics or completion changes in the same PR.
- Every formatting rule change should be backed by tests that show both intended output and non-regression cases.
- Prefer additive staging: establish observability and fixtures first, then expand behavior.

## Roadmap Overview

The roadmap is divided into pragmatic work blocks. Each block should be shippable on its own and should improve formatting without requiring completion of the entire roadmap.

1. Foundation and safety rails
2. Server-side formatter parity
3. Syntax-aware formatting core
4. Block layout and multiline normalization
5. Selection formatting and range correctness
6. Polish, hardening, and adoption

## Block 1: Foundation and Safety Rails

### Objective
Create the test and fixture infrastructure needed to evolve formatting safely.

### Why First
- The current formatter is small enough that informal changes are tempting.
- Without fixture-based coverage, formatting work will drift and regress quickly.

### Scope
- Inventory current formatting behavior and document it explicitly.
- Expand unit and integration coverage for formatter behavior on `.dla` / `.dlp` samples.
- Add representative fixtures for:
  - basic `sub` / `job` / `host` / `join` lines
  - inline comments and full-line comments
  - blank lines
  - trailing spaces
  - malformed but commonly seen input
  - files that should remain unchanged
- Decide on a stable assertion style for formatter tests:
  - input text
  - formatted output
  - idempotence check
  - optional range-format expectation

### Deliverables
- A formatter test matrix that covers current behavior and known edge cases.
- Clear fixture organization for future stages.
- Idempotence tests: formatting formatted code should produce no further changes.

### Suggested Implementation Notes
- Keep tests close to the formatter implementation if they are narrow unit tests.
- Add broader integration tests where VS Code formatting commands are part of the behavior under test.
- Use normalized line endings in assertions.

### Acceptance Criteria
- Current formatting behavior is fully described by tests rather than only by code inspection.
- New formatting work can add fixtures without rewriting the harness.
- Formatter idempotence is enforced by tests.

## Block 2: Server-Side Formatter Parity

### Objective
Move formatting onto the language server while keeping output intentionally close to the current client-side formatter.

### Why This Stage Exists
- This is the earliest point where formatter work can start paying into shared syntax infrastructure.
- It avoids building out a second formatting architecture in the client that would later be discarded.
- It keeps risk manageable because behavior is intentionally narrow and familiar.

### Scope
- Add server-side formatting support for document and range formatting.
- Route client formatting requests through the server while preserving the existing VS Code UX entry points.
- Match current output closely for the initial server-side implementation:
  - repeated-space cleanup in safe contexts
  - comma spacing normalization
  - `->` spacing normalization
  - trailing whitespace trimming
  - conservative handling of full-line comments
- Reuse token or parser infrastructure where practical, but keep the initial policy intentionally small.
- Add parity fixtures that capture:
  - exact-match parity with current behavior
  - intentional deltas where the server-side implementation is safer
  - malformed-input preservation cases

### Explicit Deferrals
- no automatic block reindentation
- no multiline wrapping policy
- no major line splitting or joining
- no canonical reflow of ambiguous malformed code
- no broad style expansion beyond current formatter expectations

### Deliverables
- A server-side formatter that is stable enough to replace the client-side implementation for current use cases.
- A thin client formatting layer that delegates behavior instead of owning style logic.
- A regression suite proving parity or intentional, documented differences from the previous formatter.

### Acceptance Criteria
- `Format Document`, `Format Selection`, and `formatOnSave` are served by the server-side formatter path.
- Typical output remains close enough to current behavior that migration risk is low.
- Parser/token improvements made for formatting are positioned for reuse by diagnostics and later formatter stages.
- The client-side formatter no longer accumulates new policy logic.

## Block 3: Syntax-Aware Formatting Core

### Objective
Expand the server-side formatter into a proper formatting engine based on parsed Emergent expression structure.

### Why This Is the Pivotal Stage
This is the point where formatting stops being a transport migration and becomes a true language capability built on shared AST work.

### Scope
- Define the formatter input model:
  - token stream only, or
  - AST plus token/comment attachment data
- Tighten parser and recovery behavior needed by both diagnostics and formatting.
- Choose how the formatter behaves on parse errors:
  - format only structurally safe regions
  - preserve unparseable spans
  - continue formatting surrounding valid syntax
- Implement a formatting pipeline with clear phases:
  - parse
  - attach comments/trivia
  - build layout decisions
  - emit minimal edits
- Establish canonical formatting decisions for common expression constructs.

### Core Policy Questions To Resolve in Code
- How are statement keywords aligned?
- How are blocks indented after `-> {` or similar constructs?
- When is a construct kept on one line versus expanded across multiple lines?
- How are comments attached to adjacent syntax?
- What happens when input is partially invalid?

### Deliverables
- A syntax-aware server-side formatting module with focused tests independent of VS Code API plumbing.
- Documented behavior for parse-success and parse-recovery paths.

### Acceptance Criteria
- Formatter decisions come from syntax, not ad hoc regex stacking.
- Formatter and diagnostics benefit from the same parser and recovery improvements.
- The formatter preserves semantics on representative corpora.
- Invalid files do not suffer destructive rewrites.

## Block 4: Block Layout and Multiline Normalization

### Objective
Introduce the first major structural formatting improvements once the syntax-aware core is stable.

### Scope
- Canonical indentation for nested blocks.
- Consistent handling of multiline expressions.
- Normalize spacing and line breaks around:
  - block open/close tokens
  - multiline argument lists
  - nested `sub` / `job` / `host` / `join` structures where applicable
  - `end` alignment and surrounding blank lines
- Define blank-line policy for readability:
  - preserve existing blank lines unless excessive
  - normalize only in obvious cases first

### Rollout Strategy
- Introduce structural rules in narrowly scoped slices.
- Add fixtures for “before vs after” on realistic files, not just single-line examples.
- Avoid bundling many unrelated style decisions into one PR.

### Deliverables
- The formatter can make files materially easier to read, not just cleaner at the whitespace level.
- The extension begins to approach the expectations users have for mature languages.

### Acceptance Criteria
- Nested and multiline constructs have a stable, documented layout.
- Formatting output is deterministic across equivalent inputs.
- Review noise remains controlled because rule introduction is staged.

## Block 5: Selection Formatting and Range Correctness

### Objective
Ensure partial formatting is reliable and behaves predictably inside editors.

### Scope
- Verify `Format Selection` behavior for partial-line and multi-line ranges.
- Prevent range formatting from breaking surrounding syntax context.
- Define whether range formatting:
  - expands to enclosing syntactic unit, or
  - stays line-bounded with reduced guarantees
- Align selection formatting behavior with document formatting wherever practical.

### Why This Matters
- Developers use selection formatting when testing a formatter incrementally.
- Broken range behavior reduces confidence in adopting full `formatOnSave`.

### Deliverables
- A clear contract for range formatting behavior.
- Tests covering partial selections, block selections, and malformed selections.

### Acceptance Criteria
- Range formatting never produces syntactically worse surrounding text.
- The behavior is documented and consistent with implementation limits.

## Block 6: Polish, Hardening, and Adoption

### Objective
Make the formatter dependable enough to recommend as a default workflow.

### Scope
- Run formatter tests against a larger representative `.dla` / `.dlp` corpus.
- Measure noisy-diff cases and refine policies that cause disproportionate churn.
- Improve performance for format-on-save responsiveness on typical files.
- Add documentation for users once formatting behavior becomes materially more powerful.
- Revisit whether the formatter should become more opinionated after low-disruption adoption is proven.

### Deliverables
- Corpus-backed confidence in formatter stability.
- Contributor guidance for future formatter rule additions.
- Updated user documentation describing actual formatting behavior.

### Acceptance Criteria
- Formatting is fast enough for routine `formatOnSave`.
- Rule changes are evaluated against representative files, not only synthetic fixtures.
- User-facing docs match implemented behavior.

## Cross-Cutting Decisions

These decisions should be made once and then applied consistently across blocks.

### 1. Parse Error Policy
Recommended early policy:
- format only syntax regions that can be handled safely
- preserve unparseable regions as much as possible
- never guess at structural rewrites when the parse is uncertain

### 2. Comment Preservation
Recommended policy:
- preserve full-line comment indentation unless formatting the enclosing block makes the correct indentation unambiguous
- do not rewrite comment text content
- preserve inline comment attachment to the preceding syntax where possible

### 3. Idempotence
Required policy:
- formatting a document twice should yield no changes after the first pass

### 4. Minimal Edit Emission
Recommended policy:
- emit the narrowest edits that express the formatter decision
- avoid replacing entire documents when line- or region-level edits are sufficient

### 5. Style Configuration
Recommended early policy:
- do not add user-facing style knobs during foundational stages
- establish one stable default style first

## Suggested Test Strategy

### Unit Coverage
- token/AST formatting decisions
- comment attachment behavior
- parse-recovery behavior
- idempotence

### Integration Coverage
- `vscode.executeFormatDocumentProvider`
- `vscode.executeFormatRangeProvider`
- representative `.dla` / `.dlp` samples opened in the extension host

### Regression Fixtures
- malformed-but-common input
- files already considered “clean”
- files with comments around block boundaries
- mixed single-line and multiline constructs

### Validation Gates Per Formatter Iteration
1. `npm run lint`
2. `npm run typecheck`
3. Narrow formatter tests
4. `npm run test:server` if parser/shared syntax logic changes
5. `npm test` when integration behavior changes and environment supports it

## Proposed Contribution Pattern

For each formatter PR:
1. State which roadmap block the change belongs to.
2. State whether the change is low-disruption or structural.
3. Add or update fixtures first.
4. Implement the smallest coherent rule set.
5. Verify idempotence and non-regression.
6. Document any intentional style-policy decisions made by the PR.

PRs should avoid:
- mixing formatter architecture changes with unrelated extension work
- introducing broad canonical rewrites before the syntax-aware core is ready
- adding new style rules without representative fixtures

## Recommended Initial Backlog

This backlog is intentionally concrete enough to guide the first several contributions.

### Foundation
- Add formatter fixture coverage for current spacing behavior.
- Add explicit tests for comments, blank lines, malformed input, and no-op files.
- Add idempotence assertions.

### Server-Side Parity
- Add formatter fixture coverage that locks in current client-side behavior.
- Add server-side document/range formatting support with near-parity output.
- Migrate the client to thin transport only.
- Define and test any intentional parity deviations, especially around comments and malformed input.

### Syntax-Aware Core
- Design the formatter module boundary and data model.
- Reuse parser outputs or expose syntax data needed by formatting.
- Tighten parser/trivia recovery needed by both diagnostics and formatting.
- Implement safe formatting for a narrow subset of constructs first.

### Structural Layout
- Add indentation for unambiguous block forms.
- Add multiline layout rules for common expression patterns.
- Expand realistic file fixtures before broadening rules.

### Hardening
- Run formatting against representative local corpora.
- Record churn patterns and tune overly aggressive rules.
- Update user docs once formatting meaningfully exceeds whitespace cleanup.

## Definition of Done for the Roadmap
- `formatOnSave` for `.dla` / `.dlp` files provides reliable structural formatting rather than only whitespace cleanup.
- Early-stage adoption did not require disruptive repo-wide rewrites.
- Formatting behavior is deterministic, tested, and documented.
- Contributors have a clear staged path for extending formatting without style drift.

## Open Questions for Future Revisions
- Should malformed-input formatting eventually become more opinionated after the parser recovery path is stronger?
- At what point is the formatter stable enough to encourage repo-wide reformatting of sample or test files?

## Maintainer Notes
- Keep this roadmap updated when a block is substantially completed or intentionally deferred.
- If implementation reality diverges from this plan, update the roadmap in the same PR that changes direction.
- Prefer documenting final style policy here and user-facing behavior in `docs/user/user-guide.md`.
