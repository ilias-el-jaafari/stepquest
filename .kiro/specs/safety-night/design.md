# Safety and night: Design

Part of the StepQuest specs; see [../README.md](../README.md). See also: [routing](../routing/requirements.md) (planner and ±5 % budget), [map-rendering](../map-rendering/requirements.md) (OSM tags in the codec).

## Safety weights

The original design document had no section for this feature. The implemented design is in `.kiro/steering/routing.md` ("Safety weights") and `src/routing/safety.ts`. Rerouting uses the same weights and the avoid list (see "Fast rerouting" in [routing](../routing/design.md)); a safety cost is a multiplier on edge length, so the step goal and its ±5 % tolerance stay the same.
