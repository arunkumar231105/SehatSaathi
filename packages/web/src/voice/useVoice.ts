import { useCallback, useEffect, useRef, useState } from 'react';
import { MicCapture } from '../audio/capture.ts';
import { getLang, resetPatient } from '../api.ts';
import { PcmPlayer } from '../audio/player.ts';

export type VoiceState = 'connecting' | 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

export interface Finding {
  ruleId: string;
  severity: 'red' | 'amber';
  reasonUr: string;
  reasonEn: string;
}

export interface Turn {
  role: 'patient' | 'agent';
  text: string;
  at: number;
}

export interface VoiceApi {
  state: VoiceState;
  turns: Turn[];
  severity: 'red' | 'amber' | 'none';
  findings: Finding[];
  caps: { tts: boolean; asr: boolean };
  error: string | null;
  pressStart: () => Promise<void>;
  pressEnd: () => void;
  sendText: (text: string) => Promise<void>;
  greet: () => void;
  dismissAlert: () => void;
}

/**
 * Owns the socket, the mic and the speaker. Press-and-hold semantics:
 * pressStart opens the mic and streams; pressEnd commits the turn.
 */
export function useVoice(patientId: string | null): VoiceApi {
  const ws = useRef<WebSocket | null>(null);
  const mic = useRef(new MicCapture());
  const player = useRef(new PcmPlayer());
  const greeted = useRef(false);

  const [state, setState] = useState<VoiceState>('connecting');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [severity, setSeverity] = useState<'red' | 'amber' | 'none'>('none');
  const [findings, setFindings] = useState<Finding[]>([]);
  const [caps, setCaps] = useState({ tts: false, asr: false });
  const [error, setError] = useState<string | null>(null);

  const partial = useRef<{ agent: string }>({ agent: '' });

  useEffect(() => {
    if (!patientId) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const sock = new WebSocket(`${proto}://${location.host}/ws/voice`);
    sock.binaryType = 'arraybuffer';
    ws.current = sock;

    player.current.onEnded = () => setState((s) => (s === 'speaking' ? 'idle' : s));

    sock.onopen = () => sock.send(JSON.stringify({ type: 'start', patientId, lang: getLang() }));
    sock.onclose = () => setState('error');
    sock.onerror = () => { setError('connection'); setState('error'); };
    sock.onmessage = (ev) => {
      const m = JSON.parse(ev.data as string) as Record<string, unknown> & { type: string };
      switch (m.type) {
        case 'ready':
          setCaps({ tts: !!m.tts, asr: !!m.asr });
          setState('idle');
          break;
        case 'state': {
          const s = m.state as VoiceState;
          // 'speaking' from the server means text is ready; audio may still be
          // arriving — the player flips us back to idle when it actually ends.
          if (s === 'idle' && player.current.playing) break;
          setState(s);
          break;
        }
        case 'user_transcript':
          setTurns((t) => [...t, { role: 'patient', text: String(m.text), at: Date.now() }]);
          break;
        case 'agent_transcript':
          partial.current.agent = String(m.text);
          setTurns((t) => [...t, { role: 'agent', text: String(m.text), at: Date.now() }]);
          break;
        case 'audio':
          setState('speaking');
          player.current.push(String(m.pcm));
          break;
        case 'no_tts':
          setState('speaking');
          player.current.speakFallback(String(m.text));
          break;
        case 'done':
          if (m.severity) {
            setSeverity(m.severity as 'red' | 'amber' | 'none');
            setFindings((m.findings as Finding[]) ?? []);
          }
          break;
        case 'error':
          setError(String(m.message));
          setState('idle');
          break;
      }
    };

    mic.current.onChunk = (pcm) => {
      if (sock.readyState === WebSocket.OPEN) sock.send(pcm);
    };

    return () => { sock.close(); };
  }, [patientId]);

  const pressStart = useCallback(async () => {
    setError(null);
    setSeverity('none');
    player.current.stop();               // barge-in
    await player.current.init();
    await mic.current.init();            // first call prompts for permission
    mic.current.start();
    setState('listening');
  }, []);

  const pressEnd = useCallback(() => {
    mic.current.stop();
    ws.current?.send(JSON.stringify({ type: 'commit' }));
    setState('thinking');
  }, []);

  const sendText = useCallback(async (text: string) => {
    if (!patientId || !text.trim()) return;
    setError(null);
    setSeverity('none');
    player.current.stop();
    await player.current.init();
    setTurns((t) => [...t, { role: 'patient', text, at: Date.now() }]);
    setState('thinking');
    try {
      let r = await fetch(`/api/patients/${patientId}/turn`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, lang: getLang() }),
      });
      // A cached patient id can outlive the row (the demo patient is reseeded).
      // Recover silently instead of showing the patient a foreign-key error.
      if (r.status === 404) {
        const fresh = await resetPatient();
        r = await fetch(`/api/patients/${fresh}/turn`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, lang: getLang() }),
        });
        location.reload();
      }
      if (!r.ok) throw new Error(`${r.status}`);
      const j = (await r.json()) as { replyUr: string; severity: 'red' | 'amber' | 'none'; findings: Finding[] };
      setTurns((t) => [...t, { role: 'agent', text: j.replyUr, at: Date.now() }]);
      setSeverity(j.severity);
      setFindings(j.findings);
      setState('speaking');
      const a = await fetch(`/api/tts?lang=${getLang()}&text=${encodeURIComponent(j.replyUr)}`);
      if (a.ok) {
        const buf = new Uint8Array(await a.arrayBuffer());
        let bin = ''; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]!);
        player.current.push(btoa(bin));
      } else player.current.speakFallback(j.replyUr);
    } catch (e) {
      setError((e as Error).message);
      setState('idle');
    }
  }, [patientId]);

  const greet = useCallback(() => {
    if (greeted.current) return;
    greeted.current = true;
    void player.current.init().then(() => ws.current?.send(JSON.stringify({ type: 'greet' })));
  }, []);

  const dismissAlert = useCallback(() => setSeverity('none'), []);

  return { state, turns, severity, findings, caps, error, pressStart, pressEnd, sendText, greet, dismissAlert };
}
