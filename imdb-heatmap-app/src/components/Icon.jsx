/**
 * Reusable Icon component using SVG sprites
 * Icons are defined in /public/icons.svg
 */
const Icon = ({ name, className = '', size = 16, ...props }) => (
    <svg
        className={className}
        width={size}
        height={size}
        aria-hidden="true"
        {...props}
    >
        <use href={`/icons.svg#${name}`} />
    </svg>
);

export default Icon;
