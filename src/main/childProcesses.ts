import type { ChildProcess } from 'child_process'

const children = new Set<ChildProcess>()

/** Remember a helper so quit can stop it. A live child keeps Electron from staying up after the window closes. */
export function trackChild(child: ChildProcess): ChildProcess {
  children.add(child)
  const drop = (): void => {
    children.delete(child)
  }
  child.once('exit', drop)
  child.once('error', drop)
  return child
}

export function killTrackedChildren(): void {
  for (const child of children) {
    try {
      child.kill()
    } catch {
      // already exited
    }
  }
  children.clear()
}
