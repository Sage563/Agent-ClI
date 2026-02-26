// Minimal client-side search implementation
const searchIndex = [
    { title: "Installation", url: "docs/installation.html", content: "node.js npm git clone install prerequisites" },
    { title: "Configuration", url: "docs/config.html", content: "agent.config.json model provider api keys endpoint" },
    { title: "Commands", url: "docs/commands.html", content: "slash commands help mcp config access session" },
    { title: "MCP Guide", url: "docs/mcp.html", content: "model context protocol servers tools npx uvx" },
    { title: "Mission Mode", url: "docs/mission.html", content: "autonomous loop multi-step implementation" },
    { title: "Architecture", url: "wiki.html", content: "core providers ui task builder applier logic" }
];

document.getElementById('site-search').addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    if (!query) return;

    // This is a placeholder for a real search results dropdown
    console.log("Searching for:", query);
});
