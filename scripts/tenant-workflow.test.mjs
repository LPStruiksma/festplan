import { readFileSync } from 'node:fs'

// The tenant check is the hosted gate the merge join reads, so every command
// it runs must be able to fail it. Plain text parsing keeps this test free of
// a YAML dependency; it splits the job into its `- name:` steps.
const workflow = readFileSync(
  new URL('../.github/workflows/autodev-tenant2-shadow.yml', import.meta.url),
  'utf8',
)

function steps() {
  return workflow
    .split(/^ {6}- name: /m)
    .slice(1)
    .map((body) => ({ name: body.split('\n')[0].trim(), body }))
}

function stepRunning(command) {
  return steps().filter((s) => /^\s+run: /m.test(s.body) && s.body.includes(command))
}

describe('tenant-baseline workflow', () => {
  it.each(['npm test', 'npm run build', 'npm run lint'])('runs %s as a required step', (command) => {
    const found = stepRunning(command)
    expect(found).toHaveLength(1)
    expect(found[0].body).not.toMatch(/continue-on-error/)
    expect(found[0].body).not.toMatch(/^\s+if: /m)
  })
})
