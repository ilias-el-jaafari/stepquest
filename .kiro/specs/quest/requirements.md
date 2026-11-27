# Quest (GPS, gems, simulation): Requirements

Part of the StepQuest specs; see [../README.md](../README.md) for the introduction, glossary and index. Requirement ids are kept from the original single spec so history stays traceable.

Related: [routing](../routing/requirements.md) (rerouting, Requirement 7c), [voice-audio](../voice-audio/requirements.md) (callouts), [retro-ui](../retro-ui/requirements.md), [map-rendering](../map-rendering/requirements.md) (streamed cells never disturb an active quest, requirement 19.12).

## Requirements

### Requirement 6 (Phase 2): GPS and checkpoints

**User Story:** As a walker, I want the map to follow me and count my checkpoints, so that the walk plays like a game.

#### Acceptance Criteria

1. WHEN the user presses "Use my location", THE SYSTEM SHALL request one high-accuracy position, use it as the start, and load a live map area (within the Overpass limits of Requirement 1) IF the position is outside the loaded map.
2. WHILE a quest is active, THE SYSTEM SHALL ignore fixes less accurate than 50 m, fixes with stale timestamps, and jumps faster than 7 m/s (unless three consecutive fixes agree), and SHALL smooth accepted fixes.
3. WHILE a quest is active, THE SYSTEM SHALL draw the walker at the position snapped to the route (or at the filtered position when off-route) and keep the camera on the walker until the user drags the map.
4. THE SYSTEM SHALL collect checkpoints only in route order, WHEN the filtered position is within 22 m of the next checkpoint (plus half of any accuracy above 10 m, at most 35 m) OR the walker passes its position along the route while on the route.
5. WHEN a checkpoint is collected, THE SYSTEM SHALL play a pickup animation and sound, and SHALL show next checkpoint, distance, direction, collected/total, distance walked, steps walked (distance ÷ stride), elapsed time and pace. WHEN the final checkpoint (the flag) is collected, THE SYSTEM SHALL show a "Quest complete" screen with stats.
6. WHEN the walker is more than 40 m (or 1.5 × accuracy) from the route for two fixes in a row, THE SYSTEM SHALL show an off-route hint with a direction.
7. IF location permission is denied, times out, is unavailable, or the page is not secure, THEN THE SYSTEM SHALL explain it in the user's language and keep the app usable (tap-to-place, simulation).
8. THE SYSTEM SHALL save the active quest to local storage and resume it after a reload or lost signal (restoring the same map), and SHALL keep the screen on with the Screen Wake Lock API where supported.
9. THE SYSTEM SHALL offer a "Simulate walk" mode that moves the walker along the route at a chosen speed with optional GPS noise.

### Requirement 6b (review, Nov 2026): A trustworthy quest runner

**User Story:** As a walker, I want my distance, gems and finish to be right even when the GPS is noisy, jumps, goes quiet or the app is reloaded, so that the game never cheats me and never gets stuck.

#### Acceptance Criteria

1. WHEN a fix has a latitude or longitude that is not a finite number in range, THE SYSTEM SHALL reject it with the reason `invalid` and SHALL NOT show the weak-signal hint for it.
2. WHEN a fix reports an accuracy of 0, a negative number, NaN or none, THE SYSTEM SHALL treat the accuracy as unknown and use 20 m for the filter, the pickup radius, the off-route threshold and the odometer, instead of rejecting the fix or trusting it as perfect.
3. WHEN a fix has a timestamp that is not later than the last accepted fix (a duplicate or an out-of-order fix), THE SYSTEM SHALL ignore it. WHEN three fixes in a row are more than 30 s behind the last accepted fix (the device clock was set back), THE SYSTEM SHALL continue from the new clock instead of freezing.
4. WHILE tracking through the browser, THE SYSTEM SHALL drop fixes whose timestamp is more than 30 s older than the device clock (a cached position delivered after the page was in the background) or more than 60 s ahead of it.
5. WHEN a fix is further from the last accepted raw fix than the walking speed limit allows (counting the accuracy of both readings), THE SYSTEM SHALL treat it as an outlier. THE SYSTEM SHALL accept a new position after outliers only WHEN three outliers in a row agree with one another, not merely WHEN three outliers arrive.
6. THE SYSTEM SHALL NOT add distance to the odometer while the walker stands still within the GPS noise: movement counts only once the smoothed position is further than twice the reported accuracy (at least 4 m, at most 30 m) from the last anchor. A position accepted after agreeing outliers SHALL add at most the distance the speed limit allows for the time elapsed. The odometer SHALL never decrease.
7. THE SYSTEM SHALL collect each gem exactly once and in route order. WHEN one fix reaches or passes several gems, THE SYSTEM SHALL collect all of them in that order. WHEN fixes are far apart in time (backgrounded page, tunnel), THE SYSTEM SHALL count a gem as passed when the walker advanced along the route no more than max(100 m, 3 m/s × elapsed time), and SHALL NOT count it for an advance the elapsed time makes implausible.
8. THE SYSTEM SHALL finish a quest only WHEN the last gem (the flag) has been collected, which requires every earlier gem to have been collected. A saved quest whose gem count is inconsistent with its route SHALL be refused instead of finishing at the next fix.
9. WHEN the walker is off the route, THE SYSTEM SHALL need to come within 70 % of the off-route distance to be on the route again (hysteresis), so one noisy fix does not reset the deviation. WHEN the "you left the route" message ends for any reason (back on the route or heading for the gem again), THE SYSTEM SHALL emit `backOnRoute`.
10. WHEN a reroute answer arrives, THE SYSTEM SHALL apply it only WHEN it was computed for this quest, this reroute count and this number of collected gems, the walker is still off the route and still within 60 m of the position it was computed for. A failed reroute request SHALL be ignored without an unhandled rejection.
11. THE SYSTEM SHALL save the quest with a schema version and SHALL migrate saved quests of an older version when loading. A saved quest of a newer version (after an app downgrade) SHALL be left in storage untouched and not resumed. A saved quest with invalid fields SHALL be discarded. A saved quest SHALL NOT be resumed on a map that does not contain its route; a demo-map quest that no longer fits SHALL be discarded.
12. THE SYSTEM SHALL add the steps of a real (not simulated) quest to the "steps today" total as they are walked, once, and for the calendar day of the fix that produced them, so that a walk ended after midnight, a quest left unfinished and an expired save are not lost, not counted twice and not moved to another day. Simulated walks SHALL NOT count.
13. THE SYSTEM SHALL hold at most one screen wake lock, SHALL release it when tracking stops even if the request resolves afterwards, and SHALL report to the UI whenever the lock is gained or lost.
14. THE SYSTEM SHALL show "no signal" WHEN a real quest has had no accepted fix for 30 s, and "weak signal" WHEN fixes have been rejected for poor accuracy for 5 s, from one pure function of the quest state and the clock.
15. THE SYSTEM SHALL keep the quest rules (filter, odometer, gems, off-route, finish, persistence format, step credit, reroute tickets) in pure modules without React or browser APIs, and the React hook SHALL only connect the location source, sound, wake lock and rendering to them.
16. WHEN the quest ends, the page is closed or the hook unmounts, THE SYSTEM SHALL stop the location source and the simulator (also in the middle of a tick), release the wake lock, drop pending reroute answers and ignore late errors and fixes.
17. WHEN the user runs the demo walk at ×1 to ×120, THE SYSTEM SHALL still collect every gem in order and finish, with and without GPS noise and glitches; a gentle reroute toward the next gem SHALL still not show "you left the route".

### Requirement 6c (task 69): Step counting

**User Story:** As a walker, I want the steps on screen to be the steps the app counts, so that 10,000 means the same everywhere.

#### Acceptance Criteria

1. THE SYSTEM SHALL keep the stride between 0.4 m and 1.2 m in whole centimetres wherever it is stored or typed (saved settings included), so the stride shown is the stride used.
2. THE SYSTEM SHALL convert metres to steps by rounding to the nearest whole step, and steps to metres without rounding; steps → metres → steps SHALL return the same number for every goal from 100 to 60,000 steps and every stride in whole centimetres.
3. WHEN the stride or the height is not a finite number, THE SYSTEM SHALL use the default stride.

### Requirement 6d: End-of-quest summary

**User Story:** As a walker, I want a full-screen summary with a small celebration when my quest ends, so that finishing (or stopping early) feels like the end of a level and I can see how I did.

#### Acceptance Criteria

1. WHEN the last gem (the flag) is collected and the finish dialogue closes, OR a finished quest is resumed after a reload, THE SYSTEM SHALL show a full-screen summary ("Quest complete!") with distance walked, steps, time, average pace, gems collected out of the total, and a short title earned.
2. WHEN the player confirms "End" on a running quest, THE SYSTEM SHALL show the same summary as a gentler "Quest paused" variant (calm wording, no fireworks, no jump) instead of leaving the quest at once. The quest SHALL stay as it is until the player chooses a button.
3. THE SYSTEM SHALL offer exactly two buttons: "Back to map" (closes the summary; for a paused quest the walk goes on) and "Plan another quest" (ends the quest and returns to planning, crediting steps as before). THE SYSTEM SHALL NOT offer sharing.
4. THE SYSTEM SHALL compute the summary from the quest stats by one pure function: gems are clamped to 0..total, non-finite numbers count as 0, pace is undefined (shown "--") until 50 m are walked, and the title is a pure function of the variant, steps, pace and gems. A completed quest SHALL never earn a paused-only title and the other way round.
5. THE SYSTEM SHALL draw the celebration in code only: falling confetti pixels and firework bursts on a low-resolution canvas, and the hero (the player's own look) hopping. A paused summary SHALL draw only a few slow twinkling pixels. The drawing SHALL be original (no third-party art) and use a bounded number of particles.
6. WHEN the user prefers reduced motion, THE SYSTEM SHALL draw one still frame of the celebration and SHALL NOT animate the canvas or the hero.
7. WHEN the summary opens, THE SYSTEM SHALL play a short synthesised chiptune fanfare (a softer two-note phrase for the paused variant) through the sound effects bus, so the sound settings (mute, voice only) silence it.
8. THE SYSTEM SHALL write the summary in English and Spanish in the game voice of `copy-voice.md`, name the dialog for assistive technology, move focus into it, and fit at 320×568 and 390×844 (the content scrolls if a short screen needs it).


### Requirement 6e (task 78): "Use my location" prepares the walk

**User Story:** As a walker who taps "Use my location" far from the demo area, I want the first plan to work straight away, so that I am not left on a map I cannot plan on.

#### Acceptance Criteria

1. WHEN a location fix is accepted, THE SYSTEM SHALL set the start to it and check whether the walking graph of the walk around it is on the device (the cells of the graph, not the drawn frame, which is larger); IF not, THE SYSTEM SHALL load it ("Loading streets…" in the locate message) before showing the location as found.
2. WHEN the start is placed by a map tap, by typed coordinates or by a saved quest, THE SYSTEM SHALL start the same load at once, in the background, so that the plan button usually finds the streets already there; a press while it still runs joins it instead of starting another.
3. IF that load fails, THEN the locate message SHALL say so with a "Retry" button, and the plan button SHALL still try again on its own when pressed (requirement 12.4 of [routing](../routing/requirements.md)).
4. THE SYSTEM SHALL keep the start the fix gave: a loaded area SHALL NOT move the start to another place.

### Requirement 6f (task 79): The walker glides

**User Story:** As a walker watching my hero, I want it to move smoothly, so that the quest does not look like a slideshow.

#### Acceptance Criteria

1. THE SYSTEM SHALL draw the walker, and in follow mode the camera, at a position that moves on every frame between fixes, at the speed measured from the last fixes, at ×1 (a fix every 2 s) as at higher speeds, as set out in [map-rendering](../map-rendering/requirements.md) requirement 24.8.
2. THE SYSTEM SHALL decouple that motion from the location source and the simulator: a fix changes the quest state once, and the frame loop reads the shown position from the clock.
3. THE SYSTEM SHALL keep the walk cycle on while fixes keep coming (held for 1.5 fix intervals, at least 1.2 s), and stop it when they stop.


### Requirement 6g (task 84): The hero moves at a steady pace and never steps back

**User Story:** As a walker watching the Bag's "Simulate walk" at ×1, I want the hero to walk at one pace and never step back, so that the test mode looks like a real walk.

#### Acceptance Criteria

1. WHILE a quest runs on the simulator or the demo, THE SYSTEM SHALL move the hero along the planned route polyline at the constant pace of the simulator (walking speed × time scale), on the frame clock, whatever the fix times, GPS noise or frame times: every frame advances by `speed × dt` within ±10 %, except at a deliberate stop at the end of the route.
2. THE SYSTEM SHALL use fixes in a simulation only to limit how far the hero may run ahead of the newest fix (20 m plus 1.5 s of walking) and to place it after a jump of more than 60 m (a resume or a reroute); a late or noisy fix SHALL NOT speed it up, slow it down or move it back.
3. WHILE a real GPS quest runs, THE SYSTEM SHALL keep the dead-reckoning glide of requirement 6f, project the glide position onto the route and show route progress that never decreases. A reading behind the shown progress by up to 15 m SHALL be ignored; when the walker truly goes back further, the hero SHALL follow 15 m behind without a jump.
4. WHILE the walker is off the route line (`offRoute`), THE SYSTEM SHALL draw the hero at the glide position, as before.
5. THE SYSTEM SHALL cover requirements 1 to 3 with property tests at ×1, ×5 and ×20 with irregular frame times and noisy fixes.
