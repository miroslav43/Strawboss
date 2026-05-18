import { useState, useCallback } from 'react';
import type { AppModalProps, AppModalType } from '@/components/shared/AppModal';

interface ShowModalParams {
  type: AppModalType;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  autoDismiss?: boolean;
}

const HIDDEN: AppModalProps = {
  visible: false,
  type: 'error',
  title: '',
  message: '',
  onConfirm: () => {},
};

export function useModal() {
  const [modalProps, setModalProps] = useState<AppModalProps>(HIDDEN);

  const hideModal = useCallback(() => {
    setModalProps((prev) => ({ ...prev, visible: false }));
  }, []);

  const showModal = useCallback(
    (params: ShowModalParams) => {
      setModalProps({
        visible: true,
        type: params.type,
        title: params.title,
        message: params.message,
        confirmText: params.confirmText,
        cancelText: params.cancelText,
        onConfirm: params.onConfirm ?? hideModal,
        onCancel: params.onCancel,
        autoDismiss: params.autoDismiss,
      });
    },
    [hideModal],
  );

  return { modalProps, showModal, hideModal };
}
