import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** Lumi must never flash console windows: no shell helpers, and every process it starts must be hidden. */
function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? sources(full) : full.endsWith('.ts') ? [full] : [];
  });
}

const files = sources(path.join(process.cwd(), 'electron'));

describe('no console windows', () => {
  it('never starts PowerShell, cmd or script hosts', () => {
    for (const f of files) {
      expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/powershell|pwsh|cmd\.exe|wscript|cscript/i);
    }
  });

  it('starts every Windows process with windowsHide', () => {
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      for (const m of text.matchAll(/\bspawn\(([^;]*?)\);?/g)) {
        if (/['"]\/(bin|usr)\//.test(m[1])) continue; // macOS-only helpers
        expect(m[1], `${path.basename(f)}: ${m[0]}`).toMatch(/windowsHide:\s*true/);
      }
      expect(text, f).not.toMatch(/(?<![.\w])(exec|execSync|spawnSync|execFileSync)\(/);
    }
  });
});
