/**
 * Translation Service - Translates text to Turkish using LibreTranslate (primary) and OpenAI (fallback)
 */

import { openaiChatCompletion } from '../openai-api';
import * as cheerio from 'cheerio';

/**
 * Translate using LibreTranslate (free, no SSL issues)
 */
async function translateWithLibreTranslate(text: string, targetLang: 'tr' | 'en'): Promise<string> {
  try {
    const response = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        protocol: 'https',
        origin: 'libretranslate.com',
        path: '/translate',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          q: text,
          source: 'en',
          target: targetLang,
          format: 'text',
          api_key: ''
        })
      })
    });

    if (!response.ok) {
      throw new Error(`LibreTranslate API error: ${response.status}`);
    }

    const data = await response.json() as { translatedText?: string };
    
    if (!data.translatedText || data.translatedText.trim().length === 0) {
      throw new Error('Empty translation result');
    }

    return data.translatedText;
  } catch (error) {
    console.error('LibreTranslate error:', error);
    throw error;
  }
}

/**
 * Strip HTML tags from text and clean up mixed content
 */
function stripHtml(html: string): string {
  try {
    // Load HTML with cheerio
    const $ = cheerio.load(html);
    
    // Remove script and style tags
    $('script, style').remove();
    
    // Get text content only
    let text = $('body').text() || $.text();
    
    // Remove pipe character and everything after it (often mixed content)
    text = text.split('|')[0] || text;
    
    // Remove URLs
    text = text.replace(/https?:\/\/[^\s]+/g, '');
    text = text.replace(/www\.[^\s]+/g, '');
    text = text.replace(/t\.co\/[^\s]+/g, '');
    
    // Remove URL parameters and source mentions
    text = text.replace(/source=(twitter|web|facebook|instagram|reddit|telegram)[^\s]*/gi, '');
    text = text.replace(/utm_[a-z_]+=[^\s&]*/gi, '');
    text = text.replace(/ref=[^\s&]*/gi, '');
    text = text.replace(/\?[a-z_]+=\w+(&[a-z_]+=\w+)*/gi, '');
    
    // Remove common artifacts and patterns
    text = text.replace(/RSVP:/gi, '');
    text = text.replace(/Read more:/gi, '');
    text = text.replace(/Click here:/gi, '');
    text = text.replace(/\[…\]/g, '');
    text = text.replace(/\[\.\.\.\]/g, '');
    
    // Clean up whitespace
    text = text
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim();
    
    // If text is too short after cleaning, return empty
    if (text.length < 10) {
      return '';
    }
    
    return text;
  } catch {
    // If cheerio fails, just remove basic HTML tags
    let text = html
      .replace(/<[^>]*>/g, ' ')
      .split('|')[0] || html
      .replace(/https?:\/\/[^\s]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    return text;
  }
}

/**
 * Translate text to a target language
 */
export async function translateText(text: string, targetLang: 'tr' | 'en'): Promise<string> {
  if (targetLang === 'en') {
    // For English, just clean HTML and return
    return stripHtml(text);
  }
  // For Turkish, use the translateToTurkish function
  return translateToTurkish(text);
}

/**
 * Translate text to Turkish using LibreTranslate (primary) with OpenAI fallback
 */
export async function translateToTurkish(text: string): Promise<string> {
  try {
    if (!text || text.trim().length === 0) {
      return text;
    }

    // Strip HTML tags before translation
    const cleanText = stripHtml(text);

    if (!cleanText || cleanText.trim().length === 0) {
      return text;
    }

    // Try LibreTranslate first (free, no SSL issues)
    try {
      const libreTranslation = await translateWithLibreTranslate(cleanText, 'tr');
      
      // Verify translation is different from original and meaningful
      if (libreTranslation && 
          libreTranslation.toLowerCase() !== cleanText.toLowerCase() && 
          libreTranslation.length > 10) {
        return libreTranslation;
      }
    } catch (libreError) {
      console.warn('LibreTranslate failed, trying OpenAI:', libreError);
    }

    // Fallback to OpenAI if LibreTranslate fails
    try {
      const response = await openaiChatCompletion({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'Sen profesyonel bir çevirmensin. Verilen metni Türkçeye çevir. SADECE Türkçe çeviriyi döndür, başka hiçbir şey ekleme. Orijinal İngilizce metni dahil etme. HTML kodlarını dahil etme. Sadece sade Türkçe metin döndür. Kripto terimleri için yaygın Türkçe karşılıklarını kullan (örn: Bitcoin, Ethereum, blockchain gibi terimler olduğu gibi kalabilir).'
          },
          {
            role: 'user',
            content: cleanText
          }
        ]
      });

      const translation = response.choices[0]?.message?.content || '';
      
      if (translation && translation.length > 10) {
        return stripHtml(translation);
      }
    } catch (openaiError) {
      console.error('OpenAI translation also failed:', openaiError);
    }

    // If both fail, return cleaned original text
    return cleanText;
  } catch (error) {
    console.error('Translation error:', error);
    return stripHtml(text);
  }
}

/**
 * Translate multiple texts in batch
 */
export async function translateBatch(texts: string[]): Promise<string[]> {
  try {
    const translations = await Promise.all(
      texts.map(text => translateToTurkish(text))
    );
    return translations;
  } catch (error) {
    console.error('Batch translation error:', error);
    return texts;
  }
}

export interface SummaryWithSentiment {
  summary: string;
  sentiment: 'positive' | 'negative' | 'neutral';
}

/**
 * Retry function with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<T> {
  let lastError: Error | undefined;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (i < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, i);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

/**
 * Summarize, translate news to Turkish, and analyze sentiment
 * Creates a concise summary, translates it, and determines if news is positive/negative
 * Includes retry mechanism for better reliability
 */
export async function summarizeAndTranslate(title: string, text?: string): Promise<SummaryWithSentiment> {
  try {
    // Truncate content if too long (max 2000 chars)
    let content = text ? `${title}\n\n${text}` : title;
    if (content.length > 2000) {
      content = content.substring(0, 2000) + '...';
    }
    
    if (!content || content.trim().length === 0) {
      return { summary: title, sentiment: 'neutral' };
    }

    // Use retry mechanism for API calls
    const result = await retryWithBackoff(async () => {
      const response = await openaiChatCompletion({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Sen kripto haber analiz uzmanısın. Verilen haberi analiz et ve şu formatta JSON döndür:
{
  "summary": "Haberin kısa Türkçe özeti (2-3 cümle, önemli detayları koru)",
  "sentiment": "positive veya negative veya neutral"
}

KRİTİK UYARILAR - MUTLAKA UYULMASI GEREKEN KURALLAR:
- Summary TAMAMEN, SADECE ve KESINLIKLE Türkçe olmalı
- Hiçbir İngilizce kelime, cümle veya ifade KULLANMA
- Orijinal İngilizce metni kesinlikle dahil etme
- Summary'nin sonuna İngilizce açıklama ekleme
- İngilizce cümlelerle bitirme (örn: "The..." "According to..." gibi)
- Kripto terimleri (Bitcoin, Ethereum, blockchain, NFT, DeFi, DAO vb.) olduğu gibi kalabilir
- Kişi isimleri (Elon Musk, Vitalik Buterin vb.) ve şirket isimleri değiştirilmez
- 100% Türkçe özet döndür, hiçbir İngilizce içerik olmasın

Sentiment belirleme kriterleri:
- positive: Fiyat artışları, pozitif gelişmeler, iyi haberler, büyüme, başarılar
- negative: Fiyat düşüşleri, hack'ler, dolandırıcılıklar, yasal sorunlar, kötü haberler
- neutral: Objektif bilgiler, analizler, nötr duyurular

SADECE JSON formatında döndür ve summary tamamen Türkçe olsun.`
          },
          {
            role: 'user',
            content: content
          }
        ],
        temperature: 0.3,
        max_tokens: 500
      });

      return response.choices[0]?.message?.content || '';
    }, 3, 1000);
    
    // Parse JSON response with better error handling
    try {
      // Clean up potential markdown code blocks
      const cleanedResult = result.replace(/```json\n?|```\n?/g, '').trim();
      const parsed = JSON.parse(cleanedResult) as SummaryWithSentiment;
      
      // Clean up summary - remove any English sentences that might be appended
      let cleanSummary = parsed.summary || title;
      
      // Remove common English patterns that might appear at the end or middle
      cleanSummary = cleanSummary
        // Remove sentences starting with common English words
        .replace(/\. [A-Z][a-z]+ (is|are|was|were|has|have|will|would|could|should|can|may|might|had|been|being)[^.]*\./g, '.')
        .replace(/\. The [^.]*\./g, '.')
        .replace(/\. This [^.]*\./g, '.')
        .replace(/\. It [^.]*\./g, '.')
        .replace(/\. According to [^.]*\./g, '.')
        .replace(/\. In [^.]*\./g, '.')
        .replace(/\. On [^.]*\./g, '.')
        .replace(/\. At [^.]*\./g, '.')
        .replace(/\. For [^.]*\./g, '.')
        .replace(/\. With [^.]*\./g, '.')
        .replace(/\. From [^.]*\./g, '.')
        .replace(/\. By [^.]*\./g, '.')
        .replace(/\. As [^.]*\./g, '.')
        .replace(/\. However[^.]*\./g, '.')
        .replace(/\. Additionally[^.]*\./g, '.')
        .replace(/\. Furthermore[^.]*\./g, '.')
        .replace(/\. Meanwhile[^.]*\./g, '.')
        .replace(/\. Moreover[^.]*\./g, '.')
        // Remove any remaining text after common English verbs/conjunctions
        .replace(/\s+(is|are|was|were|has|have|had|been|being)\s+[a-z][^.]*$/gi, '')
        .replace(/\s+(the|this|that|these|those|it|he|she|they)\s+[a-z][^.]*$/gi, '')
        // Remove standalone English words at the end
        .replace(/\s+[A-Z][a-z]+\s*$/g, '')
        .trim()
        // Clean up any double periods
        .replace(/\.+/g, '.')
        .replace(/\.\s*$/g, '.');
      
      return {
        summary: cleanSummary && cleanSummary.length > 10 ? cleanSummary : title,
        sentiment: ['positive', 'negative', 'neutral'].includes(parsed.sentiment) ? parsed.sentiment : 'neutral'
      };
    } catch (parseError) {
      console.warn('JSON parsing failed, using result as summary:', parseError);
      // If JSON parsing fails but we have content, use it as summary
      if (result && result.length > 10) {
        return { summary: result, sentiment: 'neutral' };
      }
      throw parseError;
    }
  } catch (error) {
    console.error('Summarization error:', error);
    
    // Fallback: Try simple translation without summarization
    try {
      const translatedTitle = await retryWithBackoff(
        () => translateToTurkish(title),
        2,
        500
      );
      
      // More lenient verification - accept translation if it's different or long enough
      const isDifferent = translatedTitle.toLowerCase() !== title.toLowerCase();
      const isLongEnough = translatedTitle.length > 8;
      const hasNonEnglishChars = /[üğışöçÜĞİŞÖÇ]/.test(translatedTitle);
      
      if (translatedTitle && (isDifferent || isLongEnough || hasNonEnglishChars)) {
        return { summary: translatedTitle, sentiment: 'neutral' };
      } else {
        // Last resort: return original title instead of skipping
        console.warn('Translation could not be verified, using original:', title.substring(0, 50));
        return { summary: title, sentiment: 'neutral' };
      }
    } catch (translationError) {
      console.error('Translation fallback failed:', translationError);
      // Last resort: return original title instead of throwing
      return { summary: title, sentiment: 'neutral' };
    }
  }
}

/**
 * Summarize news in English and analyze sentiment
 * Creates a concise summary in English and determines if news is positive/negative
 * Includes retry mechanism for better reliability
 */
export async function summarizeInEnglish(title: string, text?: string): Promise<SummaryWithSentiment> {
  try {
    // Truncate content if too long (max 2000 chars)
    let content = text ? `${title}\n\n${text}` : title;
    if (content.length > 2000) {
      content = content.substring(0, 2000) + '...';
    }
    
    if (!content || content.trim().length === 0) {
      return { summary: title, sentiment: 'neutral' };
    }

    // Use retry mechanism for API calls
    const result = await retryWithBackoff(async () => {
      const response = await openaiChatCompletion({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a crypto news analysis expert. Analyze the given news and return in this JSON format:
{
  "summary": "Brief English summary of the news (2-3 sentences, keep important details)",
  "sentiment": "positive or negative or neutral"
}

IMPORTANT NOTES:
- Summary must be ONLY in English, no other languages
- Keep it concise and clear
- Do not include the original text in other languages
- Only return the English summary, nothing else

Sentiment criteria:
- positive: Price increases, positive developments, good news, growth, achievements
- negative: Price drops, hacks, scams, legal issues, bad news
- neutral: Objective information, analysis, neutral announcements

Return only JSON format, nothing else.`
          },
          {
            role: 'user',
            content: content
          }
        ],
        temperature: 0.3,
        max_tokens: 500
      });

      return response.choices[0]?.message?.content || '';
    }, 3, 1000);
    
    // Parse JSON response with better error handling
    try {
      // Clean up potential markdown code blocks
      const cleanedResult = result.replace(/```json\n?|```\n?/g, '').trim();
      const parsed = JSON.parse(cleanedResult) as SummaryWithSentiment;
      
      return {
        summary: parsed.summary && parsed.summary.length > 10 ? parsed.summary : title,
        sentiment: ['positive', 'negative', 'neutral'].includes(parsed.sentiment) ? parsed.sentiment : 'neutral'
      };
    } catch (parseError) {
      console.warn('JSON parsing failed, using result as summary:', parseError);
      // If JSON parsing fails but we have content, use it as summary
      if (result && result.length > 10) {
        return { summary: result, sentiment: 'neutral' };
      }
      throw parseError;
    }
  } catch (error) {
    console.error('Summarization error:', error);
    // Ultimate fallback: return original title
    return { summary: title, sentiment: 'neutral' };
  }
}
