// Renders the profile README cards (profile/stats.svg, profile/top-langs.svg)
// from the GitHub GraphQL API. No dependencies: Node 20+ (global fetch).
//
//   GITHUB_TOKEN=… node scripts/readme-cards.mjs [login]
//   CARDS_FIXTURE=fixture.json node scripts/readme-cards.mjs   # offline render
//
// With the Actions GITHUB_TOKEN only public data is visible, which is what a
// public profile should show anyway.

import { mkdir, readFile, writeFile } from 'node:fs/promises';

const login = process.argv[2] ?? process.env.GITHUB_REPOSITORY_OWNER ?? 'YouChill';
const outDir = 'profile';

const QUERY = `
query($login: String!) {
  user(login: $login) {
    name
    login
    followers { totalCount }
    pullRequests { totalCount }
    issues { totalCount }
    contributionsCollection {
      totalCommitContributions
      totalPullRequestReviewContributions
    }
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC) {
      totalCount
      nodes {
        stargazerCount
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
  }
}`;

async function fetchUser() {
  if (process.env.CARDS_FIXTURE) {
    return JSON.parse(await readFile(process.env.CARDS_FIXTURE, 'utf8'));
  }
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is not set');
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'readme-cards',
    },
    body: JSON.stringify({ query: QUERY, variables: { login } }),
  });
  if (!res.ok) throw new Error(`GitHub API: HTTP ${res.status}`);
  const body = await res.json();
  if (body.errors?.length) throw new Error(`GitHub API: ${body.errors.map((e) => e.message).join('; ')}`);
  if (!body.data?.user) throw new Error(`GitHub API: user ${login} not found`);
  return body.data.user;
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

const theme = {
  bg: '#0d1117',
  title: '#58a6ff',
  text: '#c9d1d9',
  muted: '#8b949e',
  track: '#21262d',
  font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
};

function card({ width, height, title, body }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="t">
  <title id="t">${esc(title)}</title>
  <rect width="${width}" height="${height}" rx="6" fill="${theme.bg}"/>
  <g font-family="${theme.font}">
    <text x="24" y="36" font-size="17" font-weight="600" fill="${theme.title}">${esc(title)}</text>
${body}
  </g>
</svg>
`;
}

function statsCard(user) {
  const repos = user.repositories.nodes;
  const rows = [
    ['Total stars', repos.reduce((sum, r) => sum + r.stargazerCount, 0)],
    ['Commits (last year)', user.contributionsCollection.totalCommitContributions],
    ['Pull requests', user.pullRequests.totalCount],
    ['Reviews (last year)', user.contributionsCollection.totalPullRequestReviewContributions],
    ['Issues', user.issues.totalCount],
    ['Public repositories', user.repositories.totalCount],
  ];
  const body = rows
    .map(
      ([label, value], i) =>
        `    <text x="24" y="${70 + i * 26}" font-size="14" fill="${theme.text}">${esc(label)}</text>\n` +
        `    <text x="371" y="${70 + i * 26}" font-size="14" font-weight="600" fill="${theme.text}" text-anchor="end">${fmt(value)}</text>`,
    )
    .join('\n');
  return card({
    width: 395,
    height: 70 + rows.length * 26,
    title: `${user.name || user.login}'s GitHub Stats`,
    body,
  });
}

function langsCard(user, count = 8) {
  const totals = new Map();
  for (const repo of user.repositories.nodes) {
    for (const { size, node } of repo.languages.edges) {
      const prev = totals.get(node.name) ?? { size: 0, color: node.color };
      totals.set(node.name, { size: prev.size + size, color: prev.color ?? node.color });
    }
  }
  const all = [...totals.entries()].sort((a, b) => b[1].size - a[1].size);
  const sum = all.reduce((s, [, v]) => s + v.size, 0) || 1;
  const top = all.slice(0, count);
  const width = 300;
  const barWidth = width - 48;

  let x = 24;
  const bar = top
    .map(([name, { size, color }]) => {
      const w = (size / sum) * barWidth;
      const seg = `    <rect x="${x.toFixed(2)}" y="52" width="${w.toFixed(2)}" height="8" fill="${color ?? theme.muted}"><title>${esc(name)}</title></rect>`;
      x += w;
      return seg;
    })
    .join('\n');

  const legend = top
    .map(([name, { size, color }], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const lx = 24 + col * 130;
      const ly = 86 + row * 24;
      return (
        `    <circle cx="${lx + 5}" cy="${ly - 5}" r="5" fill="${color ?? theme.muted}"/>\n` +
        `    <text x="${lx + 16}" y="${ly}" font-size="12" fill="${theme.text}">${esc(name)} <tspan fill="${theme.muted}">${((size / sum) * 100).toFixed(1)}%</tspan></text>`
      );
    })
    .join('\n');

  return card({
    width,
    height: 86 + Math.ceil(top.length / 2) * 24,
    title: 'Most Used Languages',
    body: `    <rect x="24" y="52" width="${barWidth}" height="8" rx="4" fill="${theme.track}"/>\n${bar}\n${legend}`,
  });
}

const user = await fetchUser();
await mkdir(outDir, { recursive: true });
await writeFile(`${outDir}/stats.svg`, statsCard(user));
await writeFile(`${outDir}/top-langs.svg`, langsCard(user));
console.log(`Wrote ${outDir}/stats.svg and ${outDir}/top-langs.svg for ${user.login}`);
