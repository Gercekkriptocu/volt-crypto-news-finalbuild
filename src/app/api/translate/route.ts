import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

export const runtime = 'edge';

/**
 * Strip HTML tags from text
 */
function stripHtml(html: string): string {
  try {
    const $ = cheerio.load(html);
    $('script, style').remove();
    const text = $('body').text() || $.text();
    return text
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim();
  } catch {
    return html
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

/**
 * Translate using DeepL API
 */
async function translateWithDeepL(text: string): Promise<string | null> {
  const DEEPL_API_KEY = process.env.DEEPL_API_KEY || process.env.NEXT_PUBLIC_DEEPL_API_KEY;
  
  if (!DEEPL_API_KEY) {
    console.log('DeepL API key not found, will use fallback');
    return null;
  }

  try {
    const response = await fetch('https://api-free.deepl.com/v2/translate', {
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${DEEPL_API_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        text: text,
        target_lang: 'TR',
        source_lang: 'EN',
      }),
    });

    if (!response.ok) {
      console.error('DeepL API error:', response.status, response.statusText);
      return null;
    }

    const data = await response.json();
    return data.translations?.[0]?.text || null;
  } catch (error) {
    console.error('DeepL translation error:', error);
    return null;
  }
}

/**
 * Translate using OpenAI as fallback
 */
async function translateWithOpenAI(text: string): Promise<string> {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.NEXT_PUBLIC_OPENAI_API_KEY;
  
  if (!OPENAI_API_KEY) {
    console.error('OpenAI API key not found in environment variables');
    throw new Error('OpenAI API key not configured');
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'Sen profesyonel bir çevirmensin. Verilen kripto haber metnini Türkçeye çevir. SADECE Türkçe çeviriyi döndür, başka hiçbir şey ekleme. Orijinal İngilizce metni dahil etme. HTML kodlarını dahil etme. Sadece sade Türkçe metin döndür. Kripto terimleri için yaygın kullanımları koru (Bitcoin, Ethereum, blockchain vb.). Doğal ve akıcı Türkçe kullan.',
          },
          {
            role: 'user',
            content: text,
          },
        ],
        temperature: 0.3,
        max_tokens: 4000,
      }),
    });

    if (!response.ok) {
      console.error('OpenAI API error:', response.status, response.statusText);
      throw new Error('OpenAI translation failed');
    }

    const data = await response.json();
    const translation = data.choices?.[0]?.message?.content || text;
    
    // Clean up any remaining HTML
    return stripHtml(translation);
  } catch (error) {
    console.error('OpenAI translation error:', error);
    throw error;
  }
}

/**
 * Main translation endpoint
 */
export async function POST(request: Request) {
  try {
    const { text } = await request.json();

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return NextResponse.json(
        { error: 'Invalid text provided' },
        { status: 400 }
      );
    }

    // Strip HTML first
    const cleanText = stripHtml(text);

    if (cleanText.trim().length === 0) {
      return NextResponse.json(
        { translation: text },
        { status: 200 }
      );
    }

    // Try DeepL first (better quality for Turkish)
    let translation = await translateWithDeepL(cleanText);

    // Fallback to OpenAI if DeepL fails
    if (!translation) {
      console.log('Using OpenAI fallback for translation');
      translation = await translateWithOpenAI(cleanText);
    }

    // Final cleanup
    const finalTranslation = stripHtml(translation);

    return NextResponse.json(
      { translation: finalTranslation },
      { status: 200 }
    );
  } catch (error) {
    console.error('Translation endpoint error:', error);
    return NextResponse.json(
      { 
        error: 'Translation failed',
        translation: stripHtml((await request.json()).text) // Return cleaned original text
      },
      { status: 500 }
    );
  }
}
