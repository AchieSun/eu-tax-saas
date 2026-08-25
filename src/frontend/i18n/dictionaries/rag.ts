/**
 * RagPage 字典 — 税法问答（F5 RAG）。
 *
 * 键为扁平点分命名空间，值支持 {name} 插值（见 ../index.ts）。
 * en 缺失的 key 自动回退 zh。
 */
import type { BilingualDictionary } from './index';

export const ragDict: BilingualDictionary = {
  zh: {
    'rag.title': '税法问答 (RAG)',
    'rag.subtitle':
      '基于检索增强生成 (RAG) 的欧洲税法问答。答案仅来自内部知识库，并标注置信度与来源。',
    'rag.field.question': '问题',
    'rag.placeholder': '例如：葡萄牙 NHR 2024 年股息收入如何征税？',
    'rag.field.jurisdiction': '法域',
    'rag.field.year': '年度',
    'rag.option.auto': '自动',
    'rag.option.DE': '德国 DE',
    'rag.option.NL': '荷兰 NL',
    'rag.option.PT': '葡萄牙 PT',
    'rag.option.ES': '西班牙 ES',
    'rag.option.UK': '英国 UK',
    'rag.option.EU': '欧盟 EU',
    'rag.action.thinking': '思考中…',
    'rag.action.ask': '提问',
    'rag.answer.label': '回答',
    'rag.answer.confidence': '置信度: {value}',
    'rag.answer.year': '年度: {value}',
    'rag.answer.reasoning': '推理过程',
    'rag.answer.warnings': '⚠️ 注意',
    'rag.answer.sources': '来源',
    'rag.answer.relevance': '相关度 {value}%',
    'rag.error.unauthorized': '请先登录。',
    'rag.error.noContext': '知识库中未找到相关上下文，请换一种问法。',
  },
  en: {
    'rag.title': 'Tax-law Q&A (RAG)',
    'rag.subtitle':
      'European tax-law Q&A powered by retrieval-augmented generation (RAG). Answers draw only on the internal knowledge base, with confidence and sources.',
    'rag.field.question': 'Question',
    'rag.placeholder': 'e.g. How are 2024 NHR dividends taxed in Portugal?',
    'rag.field.jurisdiction': 'Jurisdiction',
    'rag.field.year': 'Tax year',
    'rag.option.auto': 'Auto',
    'rag.option.DE': 'Germany DE',
    'rag.option.NL': 'Netherlands NL',
    'rag.option.PT': 'Portugal PT',
    'rag.option.ES': 'Spain ES',
    'rag.option.UK': 'United Kingdom UK',
    'rag.option.EU': 'EU',
    'rag.action.thinking': 'Thinking…',
    'rag.action.ask': 'Ask',
    'rag.answer.label': 'Answer',
    'rag.answer.confidence': 'Confidence: {value}',
    'rag.answer.year': 'Tax year: {value}',
    'rag.answer.reasoning': 'Reasoning',
    'rag.answer.warnings': '⚠️ Note',
    'rag.answer.sources': 'Sources',
    'rag.answer.relevance': 'relevance {value}%',
    'rag.error.unauthorized': 'Please sign in first.',
    'rag.error.noContext':
      'No relevant context found in the knowledge base — try rephrasing the question.',
  },
};
