import { FileSignature } from 'lucide-react';
import { signatureUrlSchema } from '@strawboss/validation';
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
  // Defense-in-depth: only ever hand an <img src> a value that matches the
  // same allowlist enforced server-side on persist (internal upload path or
  // inline base64 data URL). Guards against rows written before the
  // allowlist existed and any other path that could smuggle an external URL
  // in here.
  const safeSignatureUrl =
    signatureUrl && signatureUrlSchema.safeParse(signatureUrl).success ? signatureUrl : null;

  if (!safeSignatureUrl) {
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
    <div className={cn('rounded-lg border border-neutral-200 bg-white p-4', className)}>
      <div className="mb-2 flex items-center gap-2">
        <FileSignature className="h-4 w-4 text-neutral-500" />
        <span className="text-sm font-medium text-neutral-700">Signature</span>
      </div>
      <img
        src={safeSignatureUrl}
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
