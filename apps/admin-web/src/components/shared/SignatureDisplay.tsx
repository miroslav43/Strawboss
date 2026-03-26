import { FileSignature } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SignatureDisplayProps {
  signatureUrl: string | null;
  signerName?: string | null;
  signedAt?: string | null;
  className?: string;
}

export function SignatureDisplay({
  signatureUrl,
  signerName,
  signedAt,
  className,
}: SignatureDisplayProps) {
  if (!signatureUrl) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-4',
          className,
        )}
      >
        <FileSignature className="h-5 w-5 text-neutral-400" />
        <span className="text-sm text-neutral-400">No signature</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-lg border border-neutral-200 bg-white p-4',
        className,
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <FileSignature className="h-4 w-4 text-neutral-500" />
        <span className="text-sm font-medium text-neutral-700">Signature</span>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={signatureUrl}
        alt={signerName ? `Signature of ${signerName}` : 'Signature'}
        className="max-h-24 rounded border border-neutral-100 bg-white"
      />
      {(signerName || signedAt) && (
        <div className="mt-2 text-xs text-neutral-500">
          {signerName && <p>{signerName}</p>}
          {signedAt && <p>{new Date(signedAt).toLocaleString()}</p>}
        </div>
      )}
    </div>
  );
}
