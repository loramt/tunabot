import {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
  LanguageCode,
  MediaEncoding,
} from "@aws-sdk/client-transcribe-streaming";
import { fromIni } from "@aws-sdk/credential-providers";
import { Readable } from "node:stream";

const client = new TranscribeStreamingClient({
  region: "eu-west-1",
  credentials: fromIni({ profile: "nixo" }),
});

async function* audioStream(buffer: Buffer) {
  // Send audio in 4KB chunks
  const chunkSize = 4096;
  for (let i = 0; i < buffer.length; i += chunkSize) {
    yield { AudioEvent: { AudioChunk: buffer.subarray(i, i + chunkSize) } };
  }
}

export async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
  const command = new StartStreamTranscriptionCommand({
    LanguageCode: LanguageCode.IT_IT,
    MediaEncoding: MediaEncoding.OGG_OPUS,
    MediaSampleRateHertz: 48000,
    AudioStream: audioStream(audioBuffer),
  });

  const response = await client.send(command);

  const transcripts: string[] = [];

  if (response.TranscriptResultStream) {
    for await (const event of response.TranscriptResultStream) {
      if (event.TranscriptEvent?.Transcript?.Results) {
        for (const result of event.TranscriptEvent.Transcript.Results) {
          if (!result.IsPartial && result.Alternatives?.[0]?.Transcript) {
            transcripts.push(result.Alternatives[0].Transcript);
          }
        }
      }
    }
  }

  return transcripts.join(" ").trim();
}
