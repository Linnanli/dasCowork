export function validateBranchName(
  branch: string,
  existingBranches: readonly string[]
): string | undefined {
  const value = branch.trim()
  if (!value) return '分支名称不能为空。'
  if (value.endsWith('/')) return '分支名称不能以 / 结尾。'
  if (existingBranches.includes(value)) return '分支已存在。'
  if (
    value.startsWith('/') ||
    value.endsWith('.') ||
    value.includes('//') ||
    value.includes('..') ||
    value.includes('@{') ||
    value.includes('\\') ||
    /[\s~^:?*[\]]/u.test(value) ||
    value.split('/').some((part) => part.length === 0 || part.endsWith('.lock'))
  ) {
    return '分支名称必须是安全的 Git 引用。'
  }
  return undefined
}
