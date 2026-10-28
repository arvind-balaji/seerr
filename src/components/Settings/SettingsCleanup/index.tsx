import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import useToasts from '@app/hooks/useToasts';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { ArrowDownOnSquareIcon } from '@heroicons/react/24/outline';
import type { CleanupSettings } from '@server/lib/settings';
import axios from 'axios';
import type { FormikErrors, FormikTouched } from 'formik';
import { Field, Form, Formik } from 'formik';
import { useIntl } from 'react-intl';
import useSWR from 'swr';
import * as Yup from 'yup';

const messages = defineMessages('components.Settings.SettingsCleanup', {
  toastSettingsSuccess: 'Settings saved successfully!',
  toastSettingsFailure: 'Something went wrong while saving settings.',
  cleanup: 'Library Cleanup',
  cleanupDescription:
    'Titles nobody watches are announced in Leaving Soon, then removed through Radarr and Sonarr unless someone keeps them. Needs Plex and Tautulli.',
  mode: 'Mode',
  modeTip:
    'Preview is a dry run: it shows what would happen and changes nothing.',
  modeOff: 'Off',
  modePreview: 'Preview (show what would happen, change nothing)',
  modeLive: 'Live (mark and remove titles)',
  diskHeading: 'Disk',
  diskPath: 'Disk path',
  diskPathTip:
    'A folder on the media share, mounted into Seerr, used to measure free space',
  maxUsedPercent: 'Only when disk is at least (%) full',
  leavingSoonHeading: 'Leaving Soon',
  graceDays: 'Warning period (days)',
  collectionName: 'Plex collection',
  collectionNameTip: 'Mirrors Leaving Soon in Plex. Leave blank to skip.',
  protectedLabel: 'Protected Plex label',
  protectedLabelTip: 'Titles with this label are never removed',
  keepDays: 'Keep lasts (days)',
  maxKeepsPerUser: 'Keeps per user',
  maxKeepsPerUserTip: 'Request managers are unlimited',
  importExclusion: "Add removed movies to Radarr's import exclusions",
  moviesHeading: 'Movie Rules',
  tvHeading: 'TV Rules',
  enabled: 'Enabled',
  lastWatchedDays: 'Unwatched for at least (days)',
  addedDays: 'In library for at least (days)',
  releaseYears: 'Skip releases from the last (years)',
  batchSize: 'Titles per batch',
  validationNonNegative: 'You must provide a number of 0 or more',
  validationPercent: 'You must provide a percentage between 1 and 100',
  validationBatchSize: 'You must provide a batch size of 1 or more',
});

type CleanupFormValues = Omit<CleanupSettings, 'mode'> & {
  mode: CleanupSettings['mode'];
};

type RuleKey = 'movie' | 'tv';

const ruleFields = [
  'lastWatchedDays',
  'addedDays',
  'releaseYears',
  'batchSize',
] as const;

interface NumberRowProps {
  name: string;
  label: string;
  tip?: string;
  error?: string;
  touched?: boolean;
}

const NumberRow = ({ name, label, tip, error, touched }: NumberRowProps) => (
  <div className="form-row">
    <label htmlFor={name} className="text-label">
      {label}
      {tip && <span className="label-tip">{tip}</span>}
    </label>
    <div className="form-input-area">
      <Field
        id={name}
        name={name}
        type="text"
        inputMode="numeric"
        className="short"
      />
      {error && touched && <div className="error">{error}</div>}
    </div>
  </div>
);

interface TextRowProps {
  name: string;
  label: string;
  tip?: string;
}

const TextRow = ({ name, label, tip }: TextRowProps) => (
  <div className="form-row">
    <label htmlFor={name} className="text-label">
      {label}
      {tip && <span className="label-tip">{tip}</span>}
    </label>
    <div className="form-input-area">
      <div className="form-input-field">
        <Field id={name} name={name} type="text" />
      </div>
    </div>
  </div>
);

interface CheckRowProps {
  name: string;
  label: string;
  checked: boolean;
  onToggle: () => void;
}

const CheckRow = ({ name, label, checked, onToggle }: CheckRowProps) => (
  <div className="form-row">
    <label htmlFor={name} className="checkbox-label">
      {label}
    </label>
    <div className="form-input-area">
      <Field
        type="checkbox"
        id={name}
        name={name}
        checked={checked}
        onChange={onToggle}
      />
    </div>
  </div>
);

const SettingsCleanup = () => {
  const { addToast } = useToasts();
  const intl = useIntl();
  const {
    data,
    error,
    mutate: revalidate,
  } = useSWR<CleanupSettings>('/api/v1/settings/cleanup');

  const nonNegative = () =>
    Yup.number()
      .typeError(intl.formatMessage(messages.validationNonNegative))
      .required(intl.formatMessage(messages.validationNonNegative))
      .min(0, intl.formatMessage(messages.validationNonNegative));

  const ruleSchema = () =>
    Yup.object().shape({
      lastWatchedDays: nonNegative(),
      addedDays: nonNegative(),
      releaseYears: nonNegative(),
      batchSize: Yup.number()
        .typeError(intl.formatMessage(messages.validationBatchSize))
        .required(intl.formatMessage(messages.validationBatchSize))
        .min(1, intl.formatMessage(messages.validationBatchSize)),
    });

  const CleanupSettingsSchema = Yup.object().shape({
    maxUsedPercent: Yup.number()
      .typeError(intl.formatMessage(messages.validationPercent))
      .required(intl.formatMessage(messages.validationPercent))
      .min(1, intl.formatMessage(messages.validationPercent))
      .max(100, intl.formatMessage(messages.validationPercent)),
    graceDays: nonNegative(),
    keepDays: nonNegative(),
    maxKeepsPerUser: nonNegative(),
    movie: ruleSchema(),
    tv: ruleSchema(),
  });

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  const ruleSection = (
    key: RuleKey,
    heading: string,
    values: CleanupFormValues,
    errors: FormikErrors<CleanupFormValues>,
    touched: FormikTouched<CleanupFormValues>,
    setFieldValue: (field: string, value: unknown) => void
  ) => {
    const labels: Record<(typeof ruleFields)[number], string> = {
      lastWatchedDays: intl.formatMessage(messages.lastWatchedDays),
      addedDays: intl.formatMessage(messages.addedDays),
      releaseYears: intl.formatMessage(messages.releaseYears),
      batchSize: intl.formatMessage(messages.batchSize),
    };
    const ruleErrors = errors[key] as FormikErrors<CleanupSettings['movie']>;
    const ruleTouched = touched[key] as
      | FormikTouched<CleanupSettings['movie']>
      | undefined;

    return (
      <>
        <div className="mb-6 mt-10">
          <h3 className="heading">{heading}</h3>
        </div>
        <CheckRow
          name={`${key}.enabled`}
          label={intl.formatMessage(messages.enabled)}
          checked={values[key].enabled}
          onToggle={() => setFieldValue(`${key}.enabled`, !values[key].enabled)}
        />
        {ruleFields.map((field) => (
          <NumberRow
            key={field}
            name={`${key}.${field}`}
            label={labels[field]}
            error={ruleErrors?.[field]}
            touched={ruleTouched?.[field]}
          />
        ))}
      </>
    );
  };

  return (
    <>
      <PageTitle
        title={[
          intl.formatMessage(messages.cleanup),
          intl.formatMessage(globalMessages.settings),
        ]}
      />
      <div className="mb-6">
        <h3 className="heading">{intl.formatMessage(messages.cleanup)}</h3>
        <p className="description">
          {intl.formatMessage(messages.cleanupDescription)}
        </p>
      </div>
      <div className="section">
        <Formik<CleanupFormValues>
          initialValues={{
            mode: data?.mode ?? 'off',
            diskPath: data?.diskPath ?? '',
            maxUsedPercent: data?.maxUsedPercent ?? 80,
            graceDays: data?.graceDays ?? 0,
            protectedLabel: data?.protectedLabel ?? '',
            collectionName: data?.collectionName ?? '',
            keepDays: data?.keepDays ?? 0,
            maxKeepsPerUser: data?.maxKeepsPerUser ?? 0,
            importExclusion: data?.importExclusion ?? false,
            movie: {
              enabled: data?.movie?.enabled ?? false,
              lastWatchedDays: data?.movie?.lastWatchedDays ?? 0,
              addedDays: data?.movie?.addedDays ?? 0,
              releaseYears: data?.movie?.releaseYears ?? 0,
              batchSize: data?.movie?.batchSize ?? 1,
            },
            tv: {
              enabled: data?.tv?.enabled ?? false,
              lastWatchedDays: data?.tv?.lastWatchedDays ?? 0,
              addedDays: data?.tv?.addedDays ?? 0,
              releaseYears: data?.tv?.releaseYears ?? 0,
              batchSize: data?.tv?.batchSize ?? 1,
            },
          }}
          enableReinitialize
          validationSchema={CleanupSettingsSchema}
          onSubmit={async (values) => {
            const rule = (r: CleanupSettings['movie']) => ({
              enabled: r.enabled,
              lastWatchedDays: Number(r.lastWatchedDays),
              addedDays: Number(r.addedDays),
              releaseYears: Number(r.releaseYears),
              batchSize: Number(r.batchSize),
            });
            try {
              await axios.post('/api/v1/settings/cleanup', {
                mode: values.mode,
                diskPath: values.diskPath,
                maxUsedPercent: Number(values.maxUsedPercent),
                graceDays: Number(values.graceDays),
                protectedLabel: values.protectedLabel,
                collectionName: values.collectionName,
                keepDays: Number(values.keepDays),
                maxKeepsPerUser: Number(values.maxKeepsPerUser),
                importExclusion: values.importExclusion,
                movie: rule(values.movie),
                tv: rule(values.tv),
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
            }
          }}
        >
          {({
            errors,
            touched,
            isSubmitting,
            isValid,
            values,
            setFieldValue,
          }) => {
            return (
              <Form className="section" data-testid="settings-cleanup-form">
                <div className="form-row">
                  <label htmlFor="mode" className="text-label">
                    {intl.formatMessage(messages.mode)}
                    <span className="label-tip">
                      {intl.formatMessage(messages.modeTip)}
                    </span>
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <Field as="select" id="mode" name="mode">
                        <option value="off">
                          {intl.formatMessage(messages.modeOff)}
                        </option>
                        <option value="preview">
                          {intl.formatMessage(messages.modePreview)}
                        </option>
                        <option value="live">
                          {intl.formatMessage(messages.modeLive)}
                        </option>
                      </Field>
                    </div>
                  </div>
                </div>

                <div className="mb-6 mt-10">
                  <h3 className="heading">
                    {intl.formatMessage(messages.diskHeading)}
                  </h3>
                </div>
                <TextRow
                  name="diskPath"
                  label={intl.formatMessage(messages.diskPath)}
                  tip={intl.formatMessage(messages.diskPathTip)}
                />
                <NumberRow
                  name="maxUsedPercent"
                  label={intl.formatMessage(messages.maxUsedPercent)}
                  error={errors.maxUsedPercent}
                  touched={touched.maxUsedPercent}
                />

                <div className="mb-6 mt-10">
                  <h3 className="heading">
                    {intl.formatMessage(messages.leavingSoonHeading)}
                  </h3>
                </div>
                <NumberRow
                  name="graceDays"
                  label={intl.formatMessage(messages.graceDays)}
                  error={errors.graceDays}
                  touched={touched.graceDays}
                />
                <TextRow
                  name="collectionName"
                  label={intl.formatMessage(messages.collectionName)}
                  tip={intl.formatMessage(messages.collectionNameTip)}
                />
                <TextRow
                  name="protectedLabel"
                  label={intl.formatMessage(messages.protectedLabel)}
                  tip={intl.formatMessage(messages.protectedLabelTip)}
                />
                <NumberRow
                  name="keepDays"
                  label={intl.formatMessage(messages.keepDays)}
                  error={errors.keepDays}
                  touched={touched.keepDays}
                />
                <NumberRow
                  name="maxKeepsPerUser"
                  label={intl.formatMessage(messages.maxKeepsPerUser)}
                  tip={intl.formatMessage(messages.maxKeepsPerUserTip)}
                  error={errors.maxKeepsPerUser}
                  touched={touched.maxKeepsPerUser}
                />
                <CheckRow
                  name="importExclusion"
                  label={intl.formatMessage(messages.importExclusion)}
                  checked={values.importExclusion}
                  onToggle={() =>
                    setFieldValue('importExclusion', !values.importExclusion)
                  }
                />

                {ruleSection(
                  'movie',
                  intl.formatMessage(messages.moviesHeading),
                  values,
                  errors,
                  touched,
                  setFieldValue
                )}
                {ruleSection(
                  'tv',
                  intl.formatMessage(messages.tvHeading),
                  values,
                  errors,
                  touched,
                  setFieldValue
                )}

                <div className="actions">
                  <div className="flex justify-end">
                    <span className="ml-3 inline-flex rounded-md shadow-sm">
                      <Button
                        buttonType="primary"
                        type="submit"
                        disabled={isSubmitting || !isValid}
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
      </div>
    </>
  );
};

export default SettingsCleanup;
