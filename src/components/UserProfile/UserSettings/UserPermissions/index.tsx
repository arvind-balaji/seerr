import Alert from '@app/components/Common/Alert';
import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import PermissionEdit from '@app/components/PermissionEdit';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import { ArrowDownOnSquareIcon } from '@heroicons/react/24/outline';
import axios from 'axios';
import { Form, Formik } from 'formik';
import { useRouter } from 'next/router';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages(
  'components.UserProfile.UserSettings.UserPermissions',
  {
    toastSettingsSuccess: 'Permissions saved successfully!',
    toastSettingsFailure: 'Something went wrong while saving settings.',
    permissions: 'Permissions',
    unauthorizedDescription: 'You cannot modify your own permissions.',
    autoApproveReplacements: 'Skip Approval for File Replacements',
    autoApproveReplacementsDescription:
      'Asking to replace a file from an issue deletes it, blocklists the release and downloads another right away, without waiting for an admin.',
    autoApproveReplacementsAdminOnly: 'Only admins can change this.',
  }
);

const UserPermissions = () => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const router = useRouter();
  const { user: currentUser, hasPermission } = useUser();
  const { user, revalidate: revalidateUser } = useUser({
    id: Number(router.query.userId),
  });
  const {
    data,
    error,
    mutate: revalidate,
  } = useSWR<{ permissions?: number; autoApproveReplacements?: boolean }>(
    user ? `/api/v1/user/${user?.id}/settings/permissions` : null
  );

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  if (!data) {
    return <ErrorPage statusCode={500} />;
  }

  if (currentUser?.id !== 1 && currentUser?.id === user?.id) {
    return (
      <>
        <div className="mb-6">
          <h3 className="heading">
            {intl.formatMessage(messages.permissions)}
          </h3>
        </div>
        <Alert
          title={intl.formatMessage(messages.unauthorizedDescription)}
          type="error"
        />
      </>
    );
  }

  return (
    <>
      <PageTitle
        title={[
          intl.formatMessage(messages.permissions),
          intl.formatMessage(globalMessages.usersettings),
          user?.displayName,
        ]}
      />
      <div className="mb-6">
        <h3 className="heading">{intl.formatMessage(messages.permissions)}</h3>
      </div>
      <Formik
        initialValues={{
          currentPermissions: data?.permissions,
          autoApproveReplacements: !!data?.autoApproveReplacements,
        }}
        enableReinitialize
        onSubmit={async (values) => {
          try {
            await axios.post(`/api/v1/user/${user?.id}/settings/permissions`, {
              permissions: values.currentPermissions ?? 0,
              autoApproveReplacements: values.autoApproveReplacements,
            });

            addToast(intl.formatMessage(messages.toastSettingsSuccess), {
              autoDismiss: true,
              appearance: 'success',
            });
          } catch {
            addToast(intl.formatMessage(messages.toastSettingsFailure), {
              autoDismiss: true,
              appearance: 'error',
            });
          } finally {
            revalidate();
            revalidateUser();
          }
        }}
      >
        {({ isSubmitting, setFieldValue, values }) => {
          return (
            <Form className="section">
              <div className="max-w-3xl">
                <PermissionEdit
                  actingUser={currentUser}
                  currentUser={user}
                  currentPermission={values.currentPermissions ?? 0}
                  onUpdate={(newPermission) =>
                    setFieldValue('currentPermissions', newPermission)
                  }
                />
                <div
                  className={`relative mt-4 flex items-start ${
                    hasPermission(Permission.ADMIN) ? '' : 'opacity-50'
                  }`}
                >
                  <div className="flex h-6 items-center">
                    <input
                      id="autoApproveReplacements"
                      type="checkbox"
                      disabled={!hasPermission(Permission.ADMIN)}
                      checked={values.autoApproveReplacements}
                      onChange={() =>
                        setFieldValue(
                          'autoApproveReplacements',
                          !values.autoApproveReplacements
                        )
                      }
                    />
                  </div>
                  <div className="ml-3 text-sm leading-6">
                    <label
                      htmlFor="autoApproveReplacements"
                      className="block"
                      aria-label={intl.formatMessage(
                        messages.autoApproveReplacements
                      )}
                    >
                      <div className="flex flex-col">
                        <span className="font-medium text-white">
                          {intl.formatMessage(messages.autoApproveReplacements)}
                        </span>
                        <span className="font-normal text-gray-400">
                          {intl.formatMessage(
                            messages.autoApproveReplacementsDescription
                          )}
                          {!hasPermission(Permission.ADMIN) &&
                            ` ${intl.formatMessage(
                              messages.autoApproveReplacementsAdminOnly
                            )}`}
                        </span>
                      </div>
                    </label>
                  </div>
                </div>
              </div>
              <div className="actions">
                <div className="flex justify-end">
                  <span className="ml-3 inline-flex rounded-md shadow-sm">
                    <Button
                      buttonType="primary"
                      type="submit"
                      disabled={isSubmitting}
                    >
                      <ArrowDownOnSquareIcon />
                      <span>
                        {isSubmitting
                          ? intl.formatMessage(globalMessages.saving)
                          : intl.formatMessage(globalMessages.save)}
                      </span>
                    </Button>
                  </span>
                </div>
              </div>
            </Form>
          );
        }}
      </Formik>
    </>
  );
};

export default UserPermissions;
