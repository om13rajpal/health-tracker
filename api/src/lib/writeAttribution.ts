// Attached to a WorkoutSession/FoodEntry/SleepSession only when an MCP client
// (Claude, ChatGPT) wrote it directly rather than through the web app's own
// forms — absent entirely on everything logged the ordinary way, so existing
// data needs no migration and the dashboards can tell the two apart.
export type WriteAttribution = { loggedVia: "mcp"; loggedByClient?: string };
