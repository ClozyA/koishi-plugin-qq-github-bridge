import type { Binding } from '../config'
import type { Repository } from '../types'

export class RepositoryResolver {
  private readonly groups = new Map<string, Repository>()

  constructor(bindings: Binding[]) {
    for (const item of bindings) {
      if (item.enabled) this.groups.set(item.groupId, {
        owner: item.owner,
        repo: item.repo,
        fullName: `${item.owner}/${item.repo}`,
      })
    }
  }

  resolve(groupId: string): Repository | undefined { return this.groups.get(groupId) }

  all(): Repository[] {
    return [...new Map([...this.groups.values()].map(repo => [repo.fullName.toLowerCase(), repo])).values()]
  }
}
