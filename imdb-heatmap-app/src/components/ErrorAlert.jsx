import Icon from './Icon'

/**
 * Reusable error alert banner component.
 * @param {object} props
 * @param {string} props.message - The error message to display
 */
export default function ErrorAlert({ message }) {
    if (!message) return null;

    return (
        <div
            className="flex items-center gap-2 mt-4 px-4 py-3 bg-red-900/20 border border-red-800/40 rounded-lg"
            role="alert"
        >
            <Icon name="warning" size={16} className="text-danger shrink-0" />
            <p className="text-danger font-medium text-sm">{message}</p>
        </div>
    )
}
