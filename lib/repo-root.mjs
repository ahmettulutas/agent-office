// Finds the project root of a working directory: the nearest folder above it
// that has a `.git` (a folder, or a file in a worktree) or a `.claude` folder.
// The home folder is never a project root, so `~/.claude` does not turn it into
// one, and the search stops there.

import fsp from "node:fs/promises";
import path from "node:path";

const has = async (fs, p) => {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
};

export async function findRoot(cwd, home, fs = fsp) {
  const stop = home ? path.resolve(home) : null;
  let dir = path.resolve(cwd);
  for (;;) {
    if (dir === stop) return null;
    if ((await has(fs, path.join(dir, ".git"))) || (await has(fs, path.join(dir, ".claude")))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}
