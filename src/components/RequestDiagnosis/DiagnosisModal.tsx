import Modal from '@app/components/Common/Modal';
import DiagnosisPanel from '@app/components/RequestDiagnosis/DiagnosisPanel';
import defineMessages from '@app/utils/defineMessages';
import { Transition } from '@headlessui/react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.RequestDiagnosis', {
  title: 'Request Status',
  title4k: '4K Request Status',
  close: 'Close',
});

interface DiagnosisModalProps {
  show: boolean;
  mediaId: number;
  is4k?: boolean;
  subTitle?: string;
  onClose: () => void;
  onChange?: () => void;
}

const DiagnosisModal = ({
  show,
  mediaId,
  is4k = false,
  subTitle,
  onClose,
  onChange,
}: DiagnosisModalProps) => {
  const intl = useIntl();
  return (
    <Transition
      as="div"
      enter="transition-opacity duration-300"
      enterFrom="opacity-0"
      enterTo="opacity-100"
      leave="transition-opacity duration-300"
      leaveFrom="opacity-100"
      leaveTo="opacity-0"
      show={show}
    >
      <Modal
        title={intl.formatMessage(is4k ? messages.title4k : messages.title)}
        subTitle={subTitle}
        onCancel={onClose}
        cancelText={intl.formatMessage(messages.close)}
      >
        {show && (
          <DiagnosisPanel mediaId={mediaId} is4k={is4k} onChange={onChange} />
        )}
      </Modal>
    </Transition>
  );
};

export default DiagnosisModal;
