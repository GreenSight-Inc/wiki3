<template>
  <w-banner
    v-if="state.failedCount > 0"
    class="mail-alert-banner rounded-none bg-negative text-white"
    dense
    inline-actions
    role="alert">
    <template #avatar>
      <w-icon name="mdi:alert" size="sm" />
    </template>
    {{
      t('admin.notifications.mailAlert.message', { count: state.failedCount }, state.failedCount)
    }}
    <template #action>
      <w-btn
        flat
        dense
        no-caps
        color="white"
        to="/_admin/notifications"
        :label="t('admin.notifications.mailAlert.openSettings')" />
      <w-btn
        flat
        dense
        no-caps
        color="white"
        :loading="state.isDismissing"
        :label="t('admin.notifications.mailAlert.dismiss')"
        @click="dismiss" />
    </template>
  </w-banner>
</template>

<script setup>
/**
 * Tells an administrator that notification email is failing, on every page of the main layout.
 *
 * Shown only to a session holding `manage:system`, which is what both routes behind it take, and
 * asked once per app load rather than per route change. One administrator's dismissal hides it for
 * all of them until a notification fails again.
 */
import { computed, reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { notify } from '@/composables/notify'
import { apiErrorMessage } from '@/helpers/apiError'

import { useUserStore } from '@/stores/user'

const { t } = useI18n()
const userStore = useUserStore()

const state = reactive({
  failedCount: 0,
  isChecked: false,
  isDismissing: false
})

const isAdmin = computed(() => userStore.can('manage:system'))

async function check() {
  state.isChecked = true
  try {
    const resp = await API_CLIENT.get('system/notifications/mail-alert').json()
    state.failedCount = resp?.failedCount ?? 0
  } catch {
    // -> The banner is a convenience, so a failed check shows nothing rather than an error
    state.failedCount = 0
  }
}

async function dismiss() {
  state.isDismissing = true
  try {
    await API_CLIENT.post('system/notifications/mail-alert/dismiss').json()
    state.failedCount = 0
  } catch (err) {
    notify({
      type: 'negative',
      message: t('admin.notifications.mailAlert.dismissFailed'),
      caption: apiErrorMessage(err)
    })
  }
  state.isDismissing = false
}

// -> Watched rather than read once, so that signing in without a full reload still asks
watch(
  isAdmin,
  (newValue) => {
    if (newValue && !state.isChecked) {
      check()
    }
  },
  { immediate: true }
)
</script>
