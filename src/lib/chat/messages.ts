// Texts of lib/chat (errors, and the prompts sent to models: they follow the UI language so answers come back in it)
import { defineMessages } from '../i18n';

export const t = defineMessages(
  {
    'events.parseError': '引数を解析できませんでした: {error}',
    'run.stopped': '停止しました。',
    'run.unknownTool': 'ツール「{name}」は使えません。',
    'run.repeated': '同じ呼び出しが繰り返されたため中止しました。',
    'run.forbidden': '設定でこのツールは禁止されています。',
    'run.noApprovalUi': '承認できる画面がありません。',
    'title.new': '新しいチャット',

    'summary.block': '## これまでの会話の要約\n以下は、この会話の前半を要約したものです。続きの会話の文脈として扱ってください。',
    'summary.instruction': `あなたは会話の記録係です。与えられた会話を、続きの会話に必要な情報を失わないように要約してください。
次の見出しで、箇条書き中心に日本語で書いてください（会話が別の言語なら、その言語でかまいません）。

## 目的・話題
## 重要な事実・前提（固有名詞、数値、条件、ユーザーの好みや制約）
## 決まったこと・結論
## 未解決の点・次にやること
## 直近の流れ

- 会話に書かれていないことは書かない
- コードや設定値など、後で正確に必要になりそうなものは要点を残す
- 要約だけを出力し、前置きや挨拶は書かない`,
    'summary.userLabel': '【ユーザー】',
    'summary.assistantLabel': '【アシスタント】',
    'summary.omitted': '（ここより前は長すぎるため省略）',
    'summary.previousHeading': '# これまでの要約',
    'summary.sinceHeading': '# その後の会話',
    'summary.conversationHeading': '# 会話',
    'summary.empty': '要約が空でした。別のモデルで試してください。',

    'suggest.user': 'ユーザー',
    'suggest.assistant': 'アシスタント',
    'suggest.instruction': [
      'あなたは、チャットでユーザーが次に送りそうな返信の候補を作ります。',
      '与えられた会話の続きとして、ユーザーが次に送りそうなメッセージを {count} 個考えてください。',
      '- ユーザーの立場で書く（アシスタントの立場で書かない）',
      '- それぞれ 1 文で短く（40 文字程度まで）、互いに違う方向の内容にする',
      '- 日本語で書く',
      '- 出力は JSON の文字列の配列だけ（例: ["…", "…"]）。説明や前置きは書かない'
    ].join('\n'),
    'suggest.conversation': '会話:'
  },
  {
    en: {
      'events.parseError': 'Could not parse the arguments: {error}',
      'run.stopped': 'Stopped.',
      'run.unknownTool': 'The tool "{name}" is not available.',
      'run.repeated': 'Stopped because the same call was repeated.',
      'run.forbidden': 'This tool is blocked in settings.',
      'run.noApprovalUi': 'There is no screen to approve this on.',
      'title.new': 'New chat',

      'summary.block': '## Summary of the conversation so far\nThe following is a summary of the earlier part of this conversation. Treat it as context for the rest of the conversation.',
      'summary.instruction': `You keep the record of a conversation. Summarize the given conversation without losing any information needed to continue it.
Write in English under the following headings, mainly as bullet points (if the conversation is in another language, you may write in that language).

## Goal and topic
## Key facts and assumptions (names, numbers, conditions, the user's preferences and constraints)
## Decisions and conclusions
## Open points and next steps
## Most recent flow

- Do not write anything that is not in the conversation
- Keep the essentials of anything that may be needed exactly later, such as code or settings
- Output only the summary, with no preamble or greeting`,
      'summary.userLabel': '[User]',
      'summary.assistantLabel': '[Assistant]',
      'summary.omitted': '(Earlier messages omitted because they are too long)',
      'summary.previousHeading': '# Summary so far',
      'summary.sinceHeading': '# Conversation since then',
      'summary.conversationHeading': '# Conversation',
      'summary.empty': 'The summary was empty. Try another model.',

      'suggest.user': 'User',
      'suggest.assistant': 'Assistant',
      'suggest.instruction': [
        'You write candidate replies that the user is likely to send next in a chat.',
        'As a continuation of the given conversation, come up with {count} messages the user is likely to send next.',
        '- Write as the user (not as the assistant)',
        '- Keep each one short, a single sentence (up to about 20 words), and make them go in different directions',
        '- Write in English',
        '- Output only a JSON array of strings (e.g. ["…", "…"]), with no explanation or preamble'
      ].join('\n'),
      'suggest.conversation': 'Conversation:'
    },
    zh: {
      'events.parseError': '无法解析参数：{error}',
      'run.stopped': '已停止。',
      'run.unknownTool': '工具“{name}”不可用。',
      'run.repeated': '由于重复了相同的调用，已中止。',
      'run.forbidden': '此工具已在设置中被禁止。',
      'run.noApprovalUi': '没有可以进行批准的界面。',
      'title.new': '新对话',

      'summary.block': '## 此前对话的摘要\n以下是本次对话前半部分的摘要。请将其作为后续对话的上下文。',
      'summary.instruction': `你是对话的记录员。请对给定的对话进行摘要，不要丢失继续对话所需的信息。
请按以下标题，以要点列表为主，用简体中文书写（如果对话使用其他语言，也可以用该语言）。

## 目的与话题
## 重要事实与前提（专有名词、数值、条件、用户的偏好与限制）
## 已确定的事项与结论
## 未解决的问题与下一步
## 最近的进展

- 不要写对话中没有的内容
- 代码、设置值等之后可能需要准确使用的内容，要保留要点
- 只输出摘要，不要写开场白或问候`,
      'summary.userLabel': '【用户】',
      'summary.assistantLabel': '【助手】',
      'summary.omitted': '（此前的内容过长，已省略）',
      'summary.previousHeading': '# 此前的摘要',
      'summary.sinceHeading': '# 之后的对话',
      'summary.conversationHeading': '# 对话',
      'summary.empty': '摘要为空。请换一个模型再试。',

      'suggest.user': '用户',
      'suggest.assistant': '助手',
      'suggest.instruction': [
        '你负责为聊天中用户接下来可能发送的回复生成候选。',
        '请作为所给对话的延续，想出 {count} 条用户接下来可能发送的消息。',
        '- 以用户的身份书写（不要以助手的身份书写）',
        '- 每条只写 1 句，简短（约 40 字以内），彼此的方向各不相同',
        '- 用简体中文书写',
        '- 只输出 JSON 字符串数组（例如：["…", "…"]），不要写说明或开场白'
      ].join('\n'),
      'suggest.conversation': '对话：'
    }
  }
);
