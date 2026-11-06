import { spawn, type ChildProcess } from 'child_process'

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

function killChildTree(child: ChildProcess): void {
  const pid = child.pid
  // taskkill /T stops powershell runspaces. Never target this process: /F is a crash, and Crashpad starts it again.
  if (process.platform === 'win32' && pid && pid !== process.pid) {
    try {
      const killer = spawn('taskkill.exe', ['/F', '/T', '/PID', String(pid)], {
        windowsHide: true,
        stdio: 'ignore',
        detached: true
      })
      killer.unref()
    } catch {
      // already exited
    }
  }
  try {
    child.kill()
  } catch {
    // already exited
  }
}

export function killTrackedChildren(): void {
  for (const child of children) killChildTree(child)
  children.clear()
}
