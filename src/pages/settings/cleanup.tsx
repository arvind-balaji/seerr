import SettingsCleanup from '@app/components/Settings/SettingsCleanup';
import SettingsLayout from '@app/components/Settings/SettingsLayout';
import useRouteGuard from '@app/hooks/useRouteGuard';
import { Permission } from '@app/hooks/useUser';
import type { NextPage } from 'next';

const SettingsCleanupPage: NextPage = () => {
  useRouteGuard(Permission.ADMIN);
  return (
    <SettingsLayout>
      <SettingsCleanup />
    </SettingsLayout>
  );
};

export default SettingsCleanupPage;
