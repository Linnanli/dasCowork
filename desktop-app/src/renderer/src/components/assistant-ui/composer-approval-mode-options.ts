import type { LucideIcon } from 'lucide-react'
import { HandIcon, ShieldCheckIcon, TriangleAlertIcon } from 'lucide-react'

import type { ApprovalModeKind } from '../../../../shared/codexIpcApi'

export type ApprovalModeOption = {
  id: ApprovalModeKind
  label: string
  description: string
  Icon: LucideIcon
  warning?: boolean
}

export const sandboxDocumentationUrl =
  'https://developers.openai.com/codex/concepts/sandboxing#how-you-control-it'

export const approvalModeOptions: readonly ApprovalModeOption[] = [
  {
    id: 'request-approval',
    label: '请求批准',
    description: '编辑外部文件和使用互联网时始终询问',
    Icon: HandIcon
  },
  {
    id: 'approve-for-me',
    label: '帮我批准',
    description: '仅对检测到的风险操作请求批准',
    Icon: ShieldCheckIcon
  },
  {
    id: 'full-access',
    label: '完全访问权限',
    description: '可不受限制地访问互联网和您电脑上的任何文件',
    Icon: TriangleAlertIcon,
    warning: true
  }
]
