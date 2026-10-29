import useSettings from '@app/hooks/useSettings';
import defineMessages from '@app/utils/defineMessages';
import { EyeIcon } from '@heroicons/react/24/outline';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Layout.ShadowModeBanner', {
  title: 'Shadow mode',
  description:
    'This instance only observes. Nothing is added, changed or deleted in Radarr, Sonarr or Plex, and no notifications are sent.',
});

const ShadowModeBanner = () => {
  const intl = useIntl();
  const { currentSettings } = useSettings();

  if (!currentSettings.shadowMode) {
    return null;
  }

  return (
    <div className="service-error-banner mb-4 w-full">
      <EyeIcon className="h-5 w-5 flex-shrink-0" />
      <span className="flex-1 text-left">
        <span className="font-bold">{intl.formatMessage(messages.title)}</span>
        {': '}
        {intl.formatMessage(messages.description)}
      </span>
    </div>
  );
};

export default ShadowModeBanner;
