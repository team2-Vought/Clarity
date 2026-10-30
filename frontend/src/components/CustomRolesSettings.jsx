import { useCallback, useEffect, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Delete02Icon, UserAdd01Icon } from '@hugeicons/core-free-icons';
import { deleteCustomRole, fetchCustomRoles } from '../api/discussions';
import { useToasts } from '../hooks/useToasts';
import CustomRoleDialog from './CustomRoleDialog';
import { copy } from '../copy';

const t = copy.settings;

/** Свої ролі учасників у «Налаштуваннях»: список, створення й видалення. */
export default function CustomRolesSettings() {
  const [roles, setRoles] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const { pushToast } = useToasts();

  const load = useCallback(async () => {
    try {
      setRoles((await fetchCustomRoles()).results || []);
    } catch {
      setRoles([]);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const remove = async (role) => {
    if (!window.confirm(t.rolesDeleteConfirm(role.name))) return;
    try {
      await deleteCustomRole(role.id);
      setRoles((current) => current.filter((item) => item.id !== role.id));
    } catch (err) {
      pushToast(err?.message || copy.settings.saveError);
    }
  };

  if (roles === null) return null;

  return (
    <div className="settings__sheet settings__roles">
      <div className="settings__row settings__row--stacked">
        <div className="settings__row-text">
          <span className="settings__row-title">{t.rolesTitle}</span>
          <span className="settings__row-hint">{t.rolesHint}</span>
        </div>
        {roles.length > 0 && (
          <ul className="settings__role-list">
            {roles.map((role) => (
              <li key={role.id} className="settings__role">
                <span className="settings__role-text">
                  <span className="settings__role-name">{role.name}</span>
                  <span className="settings__role-description">{role.description}</span>
                </span>
                <button
                  type="button"
                  className="settings__icon-button"
                  onClick={() => remove(role)}
                  aria-label={t.rolesDelete(role.name)}
                  title={t.rolesDelete(role.name)}
                >
                  <HugeiconsIcon icon={Delete02Icon} size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div>
          <button type="button" className="settings__button settings__button--soft" onClick={() => setIsCreating(true)}>
            <HugeiconsIcon icon={UserAdd01Icon} size={16} aria-hidden="true" />
            {t.rolesAdd}
          </button>
        </div>
      </div>
      {isCreating && (
        <CustomRoleDialog
          onClose={() => setIsCreating(false)}
          onCreated={(role) => {
            setIsCreating(false);
            setRoles((current) => [...current, role]);
          }}
        />
      )}
    </div>
  );
}
